/* =========================================================
   顾手游电竞 - 在线聊天逻辑（对接 Cloudflare Worker API）
   ---------------------------------------------------------
   依赖：api-client.js（window.GBApi）、user-auth.js（GBUser）
   每 5 秒用 ?after= 增量轮询最新消息。
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
    return pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
      pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  var box = null;
  var lastId = null;      /* 最后一条消息 id，用于 ?after= 增量轮询 */
  var historyLoaded = false;
  var timer = null;

  function renderMsgs(arr, prepend) {
    if (!box || !arr || !arr.length) return;
    var html = arr.map(function (m) {
      return '<div class="gb-chat-row">' +
        "<b>" + esc(m.username) + "</b>" +
        '<span class="gb-chat-time">' + esc(fmtTime(m.created_at)) + "</span>" +
        '<p>' + esc(m.content) + "</p></div>";
    }).join("");

    if (prepend) {
      box.insertAdjacentHTML("afterbegin", html);
    } else {
      box.insertAdjacentHTML("beforeend", html);
    }
  }

  function markLast(arr) {
    if (!arr || !arr.length) return;
    var m = arr[arr.length - 1];
    if (m && m.id != null) lastId = m.id;
  }

  function loadHistory() {
    if (!box) return;
    var status = $("#gbChatStatus");
    if (status) status.textContent = "连接中…";

    GBApi.listChat()
      .then(function (arr) {
        arr = Array.isArray(arr) ? arr : [];
        historyLoaded = true;
        if (status) status.textContent = "在线 · 每 5 秒自动刷新";
        box.innerHTML = arr.length
          ? ""
          : '<div class="gb-empty">暂无聊天记录，来说第一句吧～</div>';
        markLast(arr);
        renderMsgs(arr, false);
        box.scrollTop = box.scrollHeight;
        startTimer();
      })
      .catch(function (err) {
        if (status) status.textContent = "加载失败";
        box.innerHTML = '<div class="gb-empty">聊天记录加载失败：' +
          esc(err && err.message ? err.message : "网络异常") + "（请确认云端接口可用）</div>";
      });
  }

  function poll() {
    GBApi.listChatAfter(lastId)
      .then(function (arr) {
        arr = Array.isArray(arr) ? arr : [];
        if (!arr.length) return;
        markLast(arr);
        var wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
        var hadEmpty = box.querySelector(".gb-empty");
        if (hadEmpty) hadEmpty.remove();
        renderMsgs(arr, false);
        if (wasBottom) box.scrollTop = box.scrollHeight;
      })
      .catch(function () { /* 轮询失败静默，下轮重试 */ });
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(function () {
      if (historyLoaded) poll();
    }, 5000);
  }

  function send() {
    var input = $("#gbChatText");
    var content = (input ? input.value : "").trim();
    var errBox = $("#gbChatErr");
    if (errBox) errBox.style.display = "none";

    if (!content) return;
    if (content.length > 300) {
      if (errBox) { errBox.textContent = "消息不能超过 300 字。"; errBox.style.display = "block"; }
      return;
    }

    GBApi.postChat(content)
      .then(function (m) {
        if (input) input.value = "";
        var hadEmpty = box.querySelector(".gb-empty");
        if (hadEmpty) hadEmpty.remove();
        var arr = [m];
        markLast(arr);
        renderMsgs(arr, false);
        box.scrollTop = box.scrollHeight;
        /* 发送成功后立即轮询一次，把他人消息一并带回 */
        setTimeout(poll, 300);
      })
      .catch(function (err) {
        if (err && err.needLogin) {
          GBUser.requireLogin(function () { send(); });
          return;
        }
        if (errBox) {
          errBox.textContent = "发送失败：" + (err && err.message ? err.message : "网络异常");
          errBox.style.display = "block";
        }
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    box = $("#gbChatBox");
    var sendBtn = $("#gbChatSend");
    var input = $("#gbChatText");
    if (sendBtn) sendBtn.addEventListener("click", send);
    if (input) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });

    loadHistory();
  });
})();
