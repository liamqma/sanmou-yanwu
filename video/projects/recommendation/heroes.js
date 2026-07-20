// Hero name (中文) -> pinyin slug for https://cdn.sgmdtx.com/img/avatar/<slug>.png?v=v3.1.3
// Numeric suffixes (e.g. 诸葛亮2) are stripped for the image lookup.
const HERO_PINYIN = {
  "姜维": "jiang_wei",
  "诸葛亮": "zhu_ge_liang",
  "诸葛亮2": "zhu_ge_liang",
  "法正": "fa_zheng",
  "袁绍": "yuan_shao",
  "张飞": "zhang_fei",
  "祝融": "zhu_rong",
  "孟获": "meng_huo",
  "貂蝉": "diao_chan",
  "刘备": "liu_bei",
  "关羽": "guan_yu",
  "文丑": "wen_chou",
};

const IMG_VER = "v3.1.3";
function heroImg(name) {
  const slug = HERO_PINYIN[name] || HERO_PINYIN[name.replace(/\d+$/, "")];
  return slug ? `https://cdn.sgmdtx.com/img/avatar/${slug}.png?v=${IMG_VER}` : "";
}
