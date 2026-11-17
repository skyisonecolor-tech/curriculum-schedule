/* 블록 편성 계산을 화면과 따로 돌리는 작업자 */
importScripts('block.js');
onmessage = function (e) {
  try {
    var d = e.data;
    var r = d.mode === 'assign' ? BLOCK.assignOnly(d.input, d.layout)
      : BLOCK.solve(d.input, Object.assign({}, d.opts || {}, { onProgress: function (p) { postMessage({ progress: p }); } }));
    postMessage({ result: r });
  } catch (err) { postMessage({ error: String(err && err.message || err) }); }
};
