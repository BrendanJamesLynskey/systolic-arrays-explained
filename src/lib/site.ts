/**
 * Site-wide constants: this site's URL, its companion sites, the author's
 * slide series and repositories it links into, and its own repository.
 */

/** This site (production). */
export const SITE_URL = "https://systolic-arrays-explained.vercel.app";

/** The companion sites. */
export const DECODER_URL = "https://transformer-decoder-explained.vercel.app";
export const INFERENCE_URL = "https://llm-inference-explained.vercel.app";
export const ARCHITECTURES_URL =
  "https://llm-architectures-explained.vercel.app";
export const KERNELS_URL = "https://gpu-kernels-explained.vercel.app";
export const NUMERICS_URL = "https://numerics-explained.vercel.app";
export const TRADEOFFS_URL = "https://inference-tradeoffs-explained.vercel.app";

export const GITHUB_URL =
  "https://github.com/BrendanJamesLynskey/systolic-arrays-explained";

/** The author's RTL repository the cross-check vendors its design from. */
export const RTL_REPO =
  "https://github.com/BrendanJamesLynskey/Interview_RTL_LLM_Accelerators";
export const RTL_FILE = `${RTL_REPO}/blob/b37984fc89019d999f6866492433b6cad0977ae8/02_datapath_design/coding_challenges/challenge_01_systolic_array.sv`;

export const MAC_FILE = `${RTL_REPO}/blob/b37984fc89019d999f6866492433b6cad0977ae8/02_datapath_design/coding_challenges/challenge_02_mac_unit_fp16_int8.sv`;

/** The author's accelerator simulator (chapter 9's cross-check). */
export const SIMFRONT_URL =
  "https://github.com/BrendanJamesLynskey/Torch_Sim_Frontend";

/** The slide series the chapters link into ("go deeper"). */
export const TPU_HUB =
  "https://brendanjameslynskey.github.io/LLM_Hub_Google_TPUs/";

/** A slide in one of the author's decks (anchors are #slide-NN). */
export function deck(repo: string, slide?: number): string {
  const base = `https://brendanjameslynskey.github.io/${repo}/`;
  return slide === undefined
    ? base
    : `${base}#slide-${String(slide).padStart(2, "0")}`;
}

/** A file in this site's repository on GitHub. */
export function repoFile(path: string): string {
  return `${GITHUB_URL}/blob/main/${path}`;
}
