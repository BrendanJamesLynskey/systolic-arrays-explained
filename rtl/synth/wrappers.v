// Synthesis wrappers (rtl/synth_yosys.py): the author's MAC unit
// (rtl/mac_unit.sv, after sv2v) with its mode pin tied, so synthesis keeps
// only one datapath, and a bare unsigned multiplier for the
// width-squared comparison. Plain Verilog-2005.

module mac_int8_only (
    input  wire        clk,
    input  wire        rst_n,
    input  wire [15:0] a_in,
    input  wire [15:0] b_in,
    input  wire        clear,
    input  wire        valid_in,
    output wire [31:0] acc_int32,
    output wire        valid_out
);
  wire [31:0] unused_fp32;
  mac_unit_mixed_precision u_mac (
      .clk(clk), .rst_n(rst_n), .mode(1'b0), .a_in(a_in), .b_in(b_in),
      .clear(clear), .valid_in(valid_in),
      .acc_int32(acc_int32), .acc_fp32(unused_fp32), .valid_out(valid_out));
endmodule

module mac_fp16_only (
    input  wire        clk,
    input  wire        rst_n,
    input  wire [15:0] a_in,
    input  wire [15:0] b_in,
    input  wire        clear,
    input  wire        valid_in,
    output wire [31:0] acc_fp32,
    output wire        valid_out
);
  wire [31:0] unused_int32;
  mac_unit_mixed_precision u_mac (
      .clk(clk), .rst_n(rst_n), .mode(1'b1), .a_in(a_in), .b_in(b_in),
      .clear(clear), .valid_in(valid_in),
      .acc_int32(unused_int32), .acc_fp32(acc_fp32), .valid_out(valid_out));
endmodule

module umul #(parameter W = 8) (
    input  wire [W-1:0]   a,
    input  wire [W-1:0]   b,
    output wire [2*W-1:0] p
);
  assign p = a * b;
endmodule
