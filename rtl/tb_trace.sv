// Trace testbench for the vendored output-stationary array (Verilator 5,
// --binary --timing). Drives one GEMM exactly as the challenge's own
// testbench does (clear, then K cycles of unskewed rows of A and columns of
// B with valid_in high; the array skews them internally) and prints every
// accumulator after every rising edge:
//
//   P <edge> <valid_out> c[0][0] c[0][1] ... c[N-1][N-1]
//
// Edge 1 is the edge that samples the first valid input. The operands come
// from a.mem (row-major N x K) and b.mem (row-major K x N), 8-bit two's
// complement in hex, written by rtl/check_rtl.py. $signed() because an
// element select of a packed array is unsigned (Verilator printed it signed
// anyway; Vivado xsim, following the LRM, does not).
`timescale 1ns/1ps
module tb_trace #(parameter int N = 4, parameter int K = 4);
  localparam int DATA_W = 8, ACC_W = 32;
  logic clk = 1'b0, rst_n, load_c, valid_in;
  logic signed [N-1:0][DATA_W-1:0] a_in, b_in;
  logic signed [N-1:0][N-1:0][ACC_W-1:0] c_out;
  logic valid_out;
  logic [DATA_W-1:0] amem [N*K];
  logic [DATA_W-1:0] bmem [K*N];

  systolic_array #(.N(N), .DATA_W(DATA_W), .ACC_W(ACC_W)) dut (
    .clk(clk), .rst_n(rst_n), .a_in(a_in), .b_in(b_in), .load_c(load_c),
    .valid_in(valid_in), .c_out(c_out), .valid_out(valid_out));

  always #5 clk = ~clk;

  initial begin
    $readmemh("a.mem", amem);
    $readmemh("b.mem", bmem);
    rst_n = 1'b0; load_c = 1'b0; valid_in = 1'b0; a_in = '0; b_in = '0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    @(negedge clk); load_c = 1'b1;
    @(negedge clk); load_c = 1'b0;
    for (int p = 0; p < K + 2 * N + 2; p++) begin
      if (p < K) begin
        valid_in = 1'b1;
        for (int i = 0; i < N; i++) a_in[i] = amem[i * K + p];
        for (int j = 0; j < N; j++) b_in[j] = bmem[p * N + j];
      end else begin
        valid_in = 1'b0; a_in = '0; b_in = '0;
      end
      @(posedge clk); #1;
      $write("P %0d %0d", p + 1, valid_out);
      for (int i = 0; i < N; i++)
        for (int j = 0; j < N; j++) $write(" %0d", $signed(c_out[i][j]));
      $write("\n");
      @(negedge clk);
    end
    $finish;
  end
endmodule
