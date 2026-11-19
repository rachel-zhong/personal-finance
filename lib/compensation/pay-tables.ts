/** The tables that hold pay numbers. Parents first when adding, children first when removing. */
export const PAY_TABLES = ["comp_statements", "comp_lines", "comp_deposits", "comp_rsu_vests", "comp_w2", "comp_base_pay"] as const;
export type PayTable = (typeof PAY_TABLES)[number];
