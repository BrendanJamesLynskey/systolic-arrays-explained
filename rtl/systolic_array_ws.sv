// =============================================================================
// Weight-stationary systolic array with shadow (double-buffered) weights.
//
// Written for this site (brief 42) as the RTL counterpart of
// `simulate_ws_stream` in reference/systolic.py: chapter 5's machine, the
// first TPU's dataflow. rtl/check_rtl.py runs it in Verilator and compares
// every register of every PE after every clock edge with the model's frames.
//
// Each PE holds four registers, as in the model:
//
//   s   the stationary weight it multiplies by       (valid, tile tag, value)
//   sh  the shadow weight: the next tile's, loading  (valid, tile tag, value)
//   h   the activation passing right                 (valid, tile tag, value)
//   v   the partial sum passing down                 (valid, tile tag, value)
//
// Weights enter at the top of each column and shift down a chain of shadow
// registers, one row per cycle. A load lasts k cycles (k = the tile's rows of
// weights); in load step l, rows 0..l shift and the rows below hold, so the
// PE that still needs the previous tile's shadow weight keeps it. Each
// column counts its load steps (`w_first` restarts the count), so row r of
// column q shifts when w_valid[q] and step >= r.
//
// Activations enter at the left of each row, skewed by the controller (row
// r of a tile enters r cycles after row 0). Every weight and activation
// carries a TAG_W-bit tile tag. A PE latches an arriving activation only if
// its stationary weight or its shadow weight belongs to the same tile; if it
// is the shadow weight, the PE swaps it in on that cycle. So the swap ripples
// across the array as a diagonal right behind the previous tile's last
// activation, and a column the tile does not use (the tile is narrower than
// the array) never latches it. With the tile order of `tiles("ws", ...)`, the
// tiles a PE sees in a row differ by at most 2 in index, so a 2-bit tag
// never aliases; rtl/check_rtl.py would report any alias as a mismatch.
//
// Partial sums: row 0 starts each sum at 0; row r adds its product to the
// sum arriving from row r - 1. A tile of k rows finishes its sums in row
// k - 1 (the model takes results from there), so the array exposes every
// PE's registers and the output buffer (the testbench, here) reads the
// tile's last row.
//
// INT8 operands, INT32 partial sums (signed). Plain synthesisable SV that
// the Verilator 5 and Yosys read_verilog -sv front ends both accept.
// =============================================================================

module ws_pe #(
    parameter int DATA_W = 8,
    parameter int ACC_W = 32,
    parameter int TAG_W = 2,
    parameter bit FIRST_ROW = 1'b0
) (
    input  logic                     clk,
    input  logic                     rst_n,
    // the shadow chain: from the column's top input (row 0) or the PE above
    input  logic                     sh_en,
    input  logic                     sh_in_valid,
    input  logic [TAG_W-1:0]         sh_in_tag,
    input  logic signed [DATA_W-1:0] sh_in_data,
    // the activation from the left
    input  logic                     a_in_valid,
    input  logic [TAG_W-1:0]         a_in_tag,
    input  logic signed [DATA_W-1:0] a_in_data,
    // the partial sum from above (unused in row 0)
    input  logic signed [ACC_W-1:0]  p_in_data,
    // the registers
    output logic                     s_valid,
    output logic [TAG_W-1:0]         s_tag,
    output logic signed [DATA_W-1:0] s_data,
    output logic                     sh_valid,
    output logic [TAG_W-1:0]         sh_tag,
    output logic signed [DATA_W-1:0] sh_data,
    output logic                     h_valid,
    output logic [TAG_W-1:0]         h_tag,
    output logic signed [DATA_W-1:0] h_data,
    output logic                     v_valid,
    output logic [TAG_W-1:0]         v_tag,
    output logic signed [ACC_W-1:0]  v_data
);
  logic match_s, match_sh, latch;
  logic signed [DATA_W-1:0] w;
  logic signed [2*DATA_W-1:0] prod;
  logic signed [ACC_W-1:0] base;

  assign match_s  = s_valid && (s_tag == a_in_tag);
  assign match_sh = sh_valid && (sh_tag == a_in_tag);
  assign latch    = a_in_valid && (match_s || match_sh);
  assign w        = match_s ? s_data : sh_data;
  assign prod     = a_in_data * w;
  assign base     = FIRST_ROW ? '0 : p_in_data;

  always_ff @(posedge clk) begin
    if (!rst_n) begin
      s_valid <= 1'b0;  s_tag <= '0;  s_data <= '0;
      sh_valid <= 1'b0; sh_tag <= '0; sh_data <= '0;
      h_valid <= 1'b0;  h_tag <= '0;  h_data <= '0;
      v_valid <= 1'b0;  v_tag <= '0;  v_data <= '0;
    end else begin
      if (sh_en) begin
        sh_valid <= sh_in_valid;
        sh_tag   <= sh_in_tag;
        sh_data  <= sh_in_data;
      end
      if (latch && !match_s) begin  // swap the shadow weight in
        s_valid <= 1'b1;
        s_tag   <= sh_tag;
        s_data  <= sh_data;
      end
      h_valid <= latch;
      v_valid <= latch;
      if (latch) begin
        h_tag  <= a_in_tag;
        h_data <= a_in_data;
        v_tag  <= a_in_tag;
        v_data <= base + ACC_W'(prod);
      end
    end
  end
endmodule

module systolic_array_ws #(
    parameter int ROWS = 4,
    parameter int COLS = 4,
    parameter int DATA_W = 8,
    parameter int ACC_W = 32,
    parameter int TAG_W = 2
) (
    input  logic                                   clk,
    input  logic                                   rst_n,
    // weights, at the top of each column
    input  logic [COLS-1:0]                        w_valid,
    input  logic [COLS-1:0]                        w_first,
    input  logic [COLS-1:0][TAG_W-1:0]             w_tag,
    input  logic [COLS-1:0][DATA_W-1:0]            w_data,
    // activations, at the left of each row (already skewed)
    input  logic [ROWS-1:0]                        a_valid,
    input  logic [ROWS-1:0][TAG_W-1:0]             a_tag,
    input  logic [ROWS-1:0][DATA_W-1:0]            a_data,
    // every PE's registers (row-major)
    output logic [ROWS-1:0][COLS-1:0]              s_valid,
    output logic [ROWS-1:0][COLS-1:0][TAG_W-1:0]   s_tag,
    output logic [ROWS-1:0][COLS-1:0][DATA_W-1:0]  s_data,
    output logic [ROWS-1:0][COLS-1:0]              sh_valid,
    output logic [ROWS-1:0][COLS-1:0][TAG_W-1:0]   sh_tag,
    output logic [ROWS-1:0][COLS-1:0][DATA_W-1:0]  sh_data,
    output logic [ROWS-1:0][COLS-1:0]              h_valid,
    output logic [ROWS-1:0][COLS-1:0][TAG_W-1:0]   h_tag,
    output logic [ROWS-1:0][COLS-1:0][DATA_W-1:0]  h_data,
    output logic [ROWS-1:0][COLS-1:0]              v_valid,
    output logic [ROWS-1:0][COLS-1:0][TAG_W-1:0]   v_tag,
    output logic [ROWS-1:0][COLS-1:0][ACC_W-1:0]   v_data
);
  localparam int SW = $clog2(ROWS) + 1;

  // each column's load-step counter: step 0 on w_first, then 1, 2, ...
  logic [COLS-1:0][SW-1:0] step_q, step_now;
  genvar r, c;
  generate
    for (c = 0; c < COLS; c++) begin : g_step
      assign step_now[c] = w_first[c] ? '0 : step_q[c];
      always_ff @(posedge clk) begin
        if (!rst_n) step_q[c] <= '0;
        else if (w_valid[c]) step_q[c] <= step_now[c] + 1'b1;
      end
    end

    for (r = 0; r < ROWS; r++) begin : g_row
      for (c = 0; c < COLS; c++) begin : g_col
        logic en;
        assign en = w_valid[c] && (step_now[c] >= SW'(r));
        ws_pe #(
            .DATA_W(DATA_W), .ACC_W(ACC_W), .TAG_W(TAG_W), .FIRST_ROW(r == 0)
        ) u_pe (
            .clk(clk), .rst_n(rst_n),
            .sh_en(en),
            .sh_in_valid(r == 0 ? w_valid[c] : sh_valid[(r == 0 ? 0 : r - 1)][c]),
            .sh_in_tag  (r == 0 ? w_tag[c]   : sh_tag[(r == 0 ? 0 : r - 1)][c]),
            .sh_in_data (r == 0 ? w_data[c]  : sh_data[(r == 0 ? 0 : r - 1)][c]),
            .a_in_valid(c == 0 ? a_valid[r] : h_valid[r][(c == 0 ? 0 : c - 1)]),
            .a_in_tag  (c == 0 ? a_tag[r]   : h_tag[r][(c == 0 ? 0 : c - 1)]),
            .a_in_data (c == 0 ? a_data[r]  : h_data[r][(c == 0 ? 0 : c - 1)]),
            .p_in_data (r == 0 ? '0 : v_data[(r == 0 ? 0 : r - 1)][c]),
            .s_valid(s_valid[r][c]), .s_tag(s_tag[r][c]), .s_data(s_data[r][c]),
            .sh_valid(sh_valid[r][c]), .sh_tag(sh_tag[r][c]), .sh_data(sh_data[r][c]),
            .h_valid(h_valid[r][c]), .h_tag(h_tag[r][c]), .h_data(h_data[r][c]),
            .v_valid(v_valid[r][c]), .v_tag(v_tag[r][c]), .v_data(v_data[r][c])
        );
      end
    end
  endgenerate
endmodule
