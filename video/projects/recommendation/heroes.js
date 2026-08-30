// Hero name (中文) -> repository-local portrait asset.
const HERO_PORTRAITS = {
  "姜维": "jiang_wei.png",
  "诸葛亮": "zhu_ge_liang.png",
  "诸葛亮2": "zhu_ge_liang2.png",
  "法正": "fa_zheng.png",
  "袁绍": "yuan_shao.png",
  "张飞": "zhang_fei.png",
  "祝融": "zhu_rong_fu_ren.png",
  "孟获": "meng_huo.png",
  "貂蝉": "diao_chan.png",
  "刘备": "liu_bei.png",
  "关羽": "guan_yu.png",
  "文丑": "wen_chou.png",
};

function heroImg(name) {
  const filename = HERO_PORTRAITS[name];
  return filename ? `../../../web/public/game-assets/heroes/${filename}` : "";
}
