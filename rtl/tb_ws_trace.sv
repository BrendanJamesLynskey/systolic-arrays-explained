// Trace testbench for the weight-stationary array (rtl/systolic_array_ws.sv,
// run in Verilator 5 with --binary --timing). It replays the model's schedule at the
// array's edges: in cycle t it drives the weights entering the top of each
// column and the activations entering the left of each row exactly as
// `simulate_ws_stream` (reference/systolic.py) feeds them, read from
// top.mem and left.mem (written by rtl/check_rtl.py), and after every rising
// edge prints every register of every PE:
//
//   W <edge> then, per PE (row-major), s, sh, h, v as
//   <valid> <tag> <value>
//
// Edge t + 1 is the edge that ends the model's cycle t. Values are printed
// with $signed() (an element select of a packed array is unsigned).
// Built with -DWAVES it also writes waves.vcd (every signal), which
// rtl/check_rtl.py reads for the site's waveform panel.
//
// top.mem:  CYCLES * COLS words {valid, first, tag[1:0], value[7:0]}
// left.mem: CYCLES * ROWS words {valid, tag[1:0], value[7:0]}
`timescale 1ns/1ps
module tb_ws_trace #(parameter int ROWS = 3, parameter int COLS = 3, parameter int CYCLES = 10);
  localparam int DATA_W = 8, ACC_W = 32, TAG_W = 2;
  logic clk = 1'b0, rst_n;
  logic [COLS-1:0] w_valid, w_first;
  logic [COLS-1:0][TAG_W-1:0] w_tag;
  logic [COLS-1:0][DATA_W-1:0] w_data;
  logic [ROWS-1:0] a_valid;
  logic [ROWS-1:0][TAG_W-1:0] a_tag;
  logic [ROWS-1:0][DATA_W-1:0] a_data;
  logic [ROWS-1:0][COLS-1:0] s_valid, sh_valid, h_valid, v_valid;
  logic [ROWS-1:0][COLS-1:0][TAG_W-1:0] s_tag, sh_tag, h_tag, v_tag;
  logic [ROWS-1:0][COLS-1:0][DATA_W-1:0] s_data, sh_data, h_data;
  logic [ROWS-1:0][COLS-1:0][ACC_W-1:0] v_data;
  logic [11:0] topmem [CYCLES*COLS];
  logic [10:0] leftmem [CYCLES*ROWS];

  systolic_array_ws #(.ROWS(ROWS), .COLS(COLS), .DATA_W(DATA_W), .ACC_W(ACC_W), .TAG_W(TAG_W)) dut (
    .clk(clk), .rst_n(rst_n),
    .w_valid(w_valid), .w_first(w_first), .w_tag(w_tag), .w_data(w_data),
    .a_valid(a_valid), .a_tag(a_tag), .a_data(a_data),
    .s_valid(s_valid), .s_tag(s_tag), .s_data(s_data),
    .sh_valid(sh_valid), .sh_tag(sh_tag), .sh_data(sh_data),
    .h_valid(h_valid), .h_tag(h_tag), .h_data(h_data),
    .v_valid(v_valid), .v_tag(v_tag), .v_data(v_data));

  always #5 clk = ~clk;

  initial begin
`ifdef WAVES
    $dumpfile("waves.vcd");
    $dumpvars(0, tb_ws_trace);
`endif
    $readmemh("top.mem", topmem);
    $readmemh("left.mem", leftmem);
    rst_n = 1'b0;
    w_valid = '0; w_first = '0; w_tag = '0; w_data = '0;
    a_valid = '0; a_tag = '0; a_data = '0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    for (int t = 0; t < CYCLES; t++) begin
      for (int c = 0; c < COLS; c++) begin
        {w_valid[c], w_first[c], w_tag[c], w_data[c]} = topmem[t * COLS + c];
      end
      for (int r = 0; r < ROWS; r++) begin
        {a_valid[r], a_tag[r], a_data[r]} = leftmem[t * ROWS + r];
      end
      @(posedge clk); #1;
      $write("W %0d", t + 1);
      for (int r = 0; r < ROWS; r++)
        for (int c = 0; c < COLS; c++)
          $write(" %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d",
                 s_valid[r][c], s_tag[r][c], $signed(s_data[r][c]),
                 sh_valid[r][c], sh_tag[r][c], $signed(sh_data[r][c]),
                 h_valid[r][c], h_tag[r][c], $signed(h_data[r][c]),
                 v_valid[r][c], v_tag[r][c], $signed(v_data[r][c]));
      $write("\n");
      @(negedge clk);
    end
    $finish;
  end
endmodule
