/* =========================================================
   顾手游电竞 - 留言板逻辑（对接 Cloudflare Worker API）
   ---------------------------------------------------------
   依赖：api-client.js（window.GB_API）、user-auth.js（GBUser）
   ========================================================= */
(function () {
  "use strict";

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtTime(ts) {
    if (!ts) return "";
    var d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function loadList() {
    var list = $("#gbMsgList");
    if (!list) return;
    list.innerHTML = '<div class="gb-empty">正在加载留言…</div>';

    window.GB_API.listMessages()
      .then(function (arr) {
        arr = Array.isArray(arr) ? arr : (arr && Array.isArray(arr.list) ? arr.list : []);
        var count = $("#gbMsgCount");
        if (count) count.textContent = "共 " + arr.length + " 条";

        if (!arr.length) {
          list.innerHTML = '<div class="gb-empty">还没有留言，来抢沙发吧～</div>';
          return;
        }

        var me = window.GB_API.getUser();
        var myName = me && me.name;
        list.innerHTML = arr.slice().reverse().map(function (m) {
          var own = myName && m.username === myName;
          var delBtn = own
            ? '<button class="btn btn-ghost btn-sm gb-del" data-id="' + esc(m.id) + '" type="button">删除</button>'
            : "";
          return '<div class="gb-msg">' +
            '<div class="gb-msg-head"><b>' + esc(m.username) + "</b>" +
            '<span class="gb-msg-time">' + esc(fmtTime(m.created_at)) + "</span></div>" +
            '<p>' + esc(m.content) + "</p>" +
            (delBtn ? '<div class="gb-msg-ops">' + delBtn + "</div>" : "") +
            "</div>";
        }).join("");
      })
      .catch(function (err) {
        list.innerHTML = '<div class="gb-empty">留言加载失败：' + esc(err && err.message ? err.message : "网络异常") +
          "（请确认云端接口可用）</div>";
      });
  }

  function post() {
    var textEl = $("#gbMsgText");
    var content = (textEl ? textEl.value : "").trim();
    var okBox = $("#gbPostOk"), errBox = $("#gbPostErr");
    if (okBox) okBox.style.display = "none";
    if (errBox) errBox.style.display = "none";

    if (!content) {
      if (errBox) { errBox.textContent = "留言内容不能为空。"; errBox.style.display = "block"; }
      return;
    }
    if (content.length > 500) {
      if (errBox) { errBox.textContent = "留言内容不能超过 500 字。"; errBox.style.display = "block"; }
      return;
    }

    window.GB_API.postMessage(content)
      .then(function (m) {
        if (textEl) textEl.value = "";
        if (okBox) { okBox.textContent = "留言发表成功！"; okBox.style.display = "block"; }
        loadList();
      })
      .catch(function (err) {
        if (err && err.needLogin) {
          GBUser.requireLogin(function () {
            post();
          });
          return;
        }
        if (errBox) {
          errBox.textContent = "发表失败：" + (err && err.message ? err.message : "网络异常");
          errBox.style.display = "block";
        }
      });
  }

  function del(id) {
    window.GB_API.deleteMessage(id)
      .then(function () { loadList(); })
      .catch(function (err) {
        var errBox = $("#gbPostErr");
        if (errBox) { errBox.textContent = "删除失败：" + (err && err.message ? err.message : "网络异常"); errBox.style.display = "block"; }
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = $("#gbPostBtn");
    if (btn) btn.addEventListener("click", post);

    var list = $("#gbMsgList");
    if (list) list.addEventListener("click", function (e) {
      var d = e.target.closest(".gb-del");
      if (!d) return;
      if (!window.confirm("确定删除这条留言吗？")) return;
      del(d.getAttribute("data-id"));
    });

    loadList();
  });
})();
