/**
 * engine_v6.js — 旅游搭子测试计分引擎（与 Python engine_v6.py 同源 questions.json）
 * CAT 选路(固定18) + 支持度加权破平 + shuffle + 匹配度 + 分享编码
 * 浏览器与 Node 通用；Node 下挂到 module.exports 供 KS 一致性检验
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.TravelBuddyEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ENGINE = {};

  // 规则集（与 Python 同源，48类型全覆盖）
  var RULE_SETS = [
    ["路痴本痴","领航员","出门困难户","倒霉蛋"],
    ["出片者","打卡狂魔","纪录片导演"],
    ["纪录片导演","讲解器转世","资深剧评人"],
    ["美食雷达","路边摊冒险家","中餐续命者"],
    ["中餐续命者","外卖鉴赏家","思乡者"],
    ["躺平仙人","罗马觉皇","思乡者","时差冤魂"],
    ["夜生活之王","时差冤魂","特种兵王"],
    ["精算师","小费数学家","人型汇率计算器","现金乞丐"],
    ["社牛天花板","全村的希望","甜蜜连麦者"],
    ["赛博浪人","Wi-Fi搜寻者","手机焊脸上"],
    ["多啦A梦","失物招领者","补水狂魔"],
    ["思乡者","中餐续命者","婴幼儿"],
    ["公司顶梁柱","手机焊脸上","防盗战神"],
    ["公路之王","领航员","特种兵王","行走的攻略"],
    ["文化震惊体","肢体语言大师","假装听懂的人","讲解器转世"],
    ["购物狂魔","抽象艺术家","吟游诗人"],
    ["临时起意派","鸽子成精"],
    ["修行者","猫门信徒"],
    ["行走的攻略","避雷针"],
    ["避雷针","倒霉蛋","防盗战神"],
  ];
  var RS_SETS = RULE_SETS.map(function (a) { var s = {}; for (var i=0;i<a.length;i++) s[a[i]]=1; return s; });

  // RULE_PRIORITY 由 setRulePriority(questions) 注入（覆盖反序）
  var RULE_PRIORITY = {};

  ENGINE.setRulePriority = function (questions, types) {
    var cov = {};
    for (var i=0;i<types.length;i++) cov[types[i]]=0;
    for (var q=0;q<questions.length;q++){
      var opts=questions[q].opts;
      for (var o=0;o<opts.length;o++){
        var w=opts[o].weights;
        for (var k=0;k<w.length;k++){ cov[w[k][0]] += w[k][1]; }
      }
    }
    var ranked = types.slice().sort(function(a,b){ return cov[a]-cov[b]; });
    RULE_PRIORITY = {};
    for (var i=0;i<ranked.length;i++){ RULE_PRIORITY[ranked[i]] = ranked.length - i; }
  };

  function supportOf(t) {
    var n = 0;
    for (var i=0;i<RS_SETS.length;i++){ if (RS_SETS[i][t]) n++; }
    return n;
  }

  ENGINE.calcWinner = function (scores) {
    var keys = Object.keys(scores);
    var arr = keys.map(function(k){ return [k, scores[k]]; });
    arr.sort(function(a,b){ return b[1]-a[1]; });
    var top = arr[0][1];
    var tied = arr.filter(function(e){ return e[1]===top; }).map(function(e){ return e[0]; });
    if (tied.length === 1) return { winner: tied[0], resolvedBy: "score" };
    var support = {};
    for (var i=0;i<tied.length;i++){
      var t = tied[i];
      support[t] = supportOf(t) + (RULE_PRIORITY[t]||0)*0.001;
    }
    var mx = -1;
    for (var k in support){ if (support[k]>mx) mx=support[k]; }
    var best = tied.filter(function(t){ return Math.abs(support[t]-mx)<0.0001; });
    if (best.length===1) return { winner: best[0], resolvedBy: "support" };
    best.sort(function(a,b){ return (RULE_PRIORITY[b]||0)-(RULE_PRIORITY[a]||0); });
    return { winner: best[0], resolvedBy: "support_pri" };
  };

  ENGINE.selectNext = function (questions, dims, answeredIds, scores, step, rng) {
    var recentDims = [];
    for (var i=Math.max(0,answeredIds.length-2); i<answeredIds.length; i++){
      for (var q=0;q<questions.length;q++){
        if (questions[q].id===answeredIds[i]){ recentDims.push(questions[q].dim); break; }
      }
    }
    var used = {}; for (var i=0;i<answeredIds.length;i++) used[answeredIds[i]]=1;
    var layer = step<10 ? "core" : (step<16 ? "select" : "explore");
    function pool(filter){
      return questions.filter(function(q){
        return q.layer===layer && !used[q.id] && (filter? filter(q): true);
      });
    }
    var cands = pool(function(q){ return recentDims.indexOf(q.dim)===-1; });
    if (!cands.length) cands = pool();
    if (!cands.length) cands = questions.filter(function(q){ return !used[q.id]; });
    if (!cands.length) return null;

    if (step < 10) {
      for (var d=0; d<dims.length; d++){
        if (recentDims.indexOf(dims[d])!==-1) continue;
        var p = cands.filter(function(q){ return q.dim===dims[d]; });
        if (p.length) return p[Math.floor(rng()*p.length)];
      }
      return cands[Math.floor(rng()*cands.length)];
    } else if (step < 16) {
      var dimCnt = {};
      for (var d=0; d<dims.length; d++) dimCnt[dims[d]]=0;
      for (var i=0;i<answeredIds.length;i++){
        for (var q=0;q<questions.length;q++){
          if (questions[q].id===answeredIds[i]){ dimCnt[questions[q].dim]=(dimCnt[questions[q].dim]||0)+1; break; }
        }
      }
      var order = dims.filter(function(d){ return recentDims.indexOf(d)===-1; });
      order.sort(function(a,b){ return (dimCnt[a]||0)-(dimCnt[b]||0); });
      for (var d=0; d<order.length; d++){
        var p = cands.filter(function(q){ return q.dim===order[d]; });
        if (p.length) return p[Math.floor(rng()*p.length)];
      }
      return cands[Math.floor(rng()*cands.length)];
    } else {
      var sk = Object.keys(scores).map(function(k){ return [k,scores[k]]; });
      sk.sort(function(a,b){ return b[1]-a[1]; });
      var top2 = [sk[0][0], sk[1]?sk[1][0]:sk[0][0]];
      var pref = cands.filter(function(q){
        return q.mains.some(function(m){ return top2.indexOf(m)!==-1; });
      });
      if (pref.length) return pref[Math.floor(rng()*pref.length)];
      return cands[Math.floor(rng()*cands.length)];
    }
  };

  ENGINE.applyAnswer = function (scores, q, choiceIdx) {
    var w = q.opts[choiceIdx].weights;
    for (var i=0;i<w.length;i++){ scores[w[i][0]] = (scores[w[i][0]]||0) + w[i][1]; }
  };

  ENGINE.shuffleOptions = function (options) {
    var a = options.slice();
    for (var i=a.length-1;i>0;i--){
      var j = Math.floor(Math.random()*(i+1));
      var t=a[i]; a[i]=a[j]; a[j]=t;
    }
    return a;
  };

  ENGINE.matchRate = function (scores, winner, answeredQs) {
    var mp=0, actual=scores[winner];
    for (var i=0;i<answeredQs.length;i++){
      var best=0, opts=answeredQs[i].opts;
      for (var o=0;o<opts.length;o++){
        var w=opts[o].weights;
        for (var k=0;k<w.length;k++){ if (w[k][0]===winner && w[k][1]>best) best=w[k][1]; }
      }
      mp += best;
    }
    if (mp<=0) return 50.0;
    var rate = actual/mp*100;
    return Math.max(Math.round(rate*10)/10, 35.0);
  };

  // 分享链接编码
  ENGINE.encodeShare = function (resultId, path) {
    var s = path.map(function(p){ return p[0]+":"+p[1]; }).join(",");
    return "#r=" + encodeURIComponent(resultId) + "&p=" + btoa(unescape(encodeURIComponent(s)));
  };
  ENGINE.decodeShare = function (hash) {
    var params = new URLSearchParams(hash.replace(/^#/,""));
    var r = params.get("r");
    var pRaw = params.get("p");
    var path = [];
    if (pRaw) {
      var s = decodeURIComponent(escape(atob(pRaw)));
      path = s.split(",").map(function(seg){ var p=seg.split(":"); return [p[0], parseInt(p[1])]; });
    }
    return { resultId: r, path: path };
  };

  ENGINE.RULE_SETS = RULE_SETS;
  return ENGINE;
});
