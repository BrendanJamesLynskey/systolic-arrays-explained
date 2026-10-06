// Trace testbench for the vendored mixed-precision MAC unit (Verilator 5,
// --binary --timing). Drives one operation per clock cycle from ops.mem and
// prints every pipeline register after every rising edge:
//
//   M <edge> <s1_a> <s1_b> <s1_valid> <s1_clear> <s2_fp32_product>
//     <s2_int8_product> <s2_valid> <s2_clear> <fp32_acc> <int32_acc> <valid_out>
//
// (one line; operands and FP32 values in hex, the INT8 product and INT32
// accumulator in signed decimal). Edge 1 samples the first operation. Each
// line of ops.mem is {clear, valid, a[15:0], b[15:0]} in hex, written by
// rtl/check_rtl.py; MODE is 0 (INT8) or 1 (FP16) for the whole run. The
// registers are read through hierarchical references into the DUT.
`timescale 1ns/1ps
module tb_mac_trace #(parameter int MODE = 1, parameter int COUNT = 8);
  logic clk = 1'b0, rst_n, mode, clear, valid_in;
  logic [15:0] a_in, b_in;
  logic [31:0] acc_int32, acc_fp32;
  logic valid_out;
  logic [33:0] ops [COUNT];

  mac_unit_mixed_precision dut (
    .clk(clk), .rst_n(rst_n), .mode(mode), .a_in(a_in), .b_in(b_in),
    .clear(clear), .valid_in(valid_in), .acc_int32(acc_int32),
    .acc_fp32(acc_fp32), .valid_out(valid_out));

  always #5 clk = ~clk;

  initial begin
    $readmemh("ops.mem", ops);
    rst_n = 1'b0; mode = MODE[0]; clear = 1'b0; valid_in = 1'b0;
    a_in = '0; b_in = '0;
    repeat (3) @(negedge clk);
    rst_n = 1'b1;
    for (int p = 0; p < COUNT + 3; p++) begin
      if (p < COUNT) begin
        {clear, valid_in, a_in, b_in} = ops[p];
      end else begin
        clear = 1'b0; valid_in = 1'b0; a_in = '0; b_in = '0;
      end
      @(posedge clk); #1;
      $write("M %0d %h %h %0d %0d", p + 1,
             (MODE == 1) ? dut.s1_a_fp16 : {8'h00, dut.s1_a_int8},
             (MODE == 1) ? dut.s1_b_fp16 : {8'h00, dut.s1_b_int8},
             dut.s1_valid, dut.s1_clear);
      $write(" %h %0d %0d %0d", dut.s2_fp32_product,
             $signed(dut.s2_int8_product), dut.s2_valid, dut.s2_clear);
      $write(" %h %0d %0d\n", acc_fp32, $signed(acc_int32), valid_out);
      @(negedge clk);
    end
    $finish;
  end
endmodule
