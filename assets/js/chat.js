/* =========================================================
   顾手游电竞 - KOOK 风格房间制语音房逻辑
   ---------------------------------------------------------
   依赖：api-client.js（window.GB_API）、user-auth.js（GBUser）
   - 左栏：固定"大厅"入口（房间号 0，走 /api/chat）+ 房间列表 15 秒轮询
   - 右栏：当前频道（大厅/房间）消息 5 秒增量轮询（?after=）
   - 弹窗：创建房间 / 密码房加入 / 房主管理（改名·改密·踢人·解散）
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

  function getUser() {
    try { return window.GB_API.getUser(); } catch (e) { return null; }
  }

  function requireLogin(cb) {
    if (window.GBUser && typeof window.GBUser.requireLogin === "function") {
      window.GBUser.requireLogin(cb);
      return;
    }
    if (window.GB_API.isLoggedIn()) { if (cb) cb(); }
    else { cb && cb(); }
  }

  /* ---------------- 状态 ---------------- */
  var rooms = [];          /* 房间列表缓存 */
  var current = null;      /* 当前频道：大厅 { room_no:0, name:"大厅", lobby:true } 或房间 { room_no, name, has_pass, owner_name, member_count } */
  var isOwner = false;     /* 当前用户是否为当前房间房主（大厅无房主概念） */
  var lastId = 0;          /* 当前房间最后一条消息 id */
  var roomTimer = null;    /* 房间列表轮询 */
  var chatTimer = null;    /* 消息轮询 */
  var box = null;

  function showErr(msg) {
    var e = $("#gbChatErr");
    if (!e) return;
    e.textContent = msg;
    e.style.display = "block";
  }
  function hideErr() {
    var e = $("#gbChatErr");
    if (e) e.style.display = "none";
  }
  function showManageErr(msg) {
    var e = $("#gbRoomManageErr");
    if (e) { e.textContent = msg; e.style.display = "block"; }
    var ok = $("#gbRoomManageOk");
    if (ok) ok.style.display = "none";
  }
  function showManageOk(msg) {
    var ok = $("#gbRoomManageOk");
    if (ok) { ok.textContent = msg; ok.style.display = "block"; }
    var e = $("#gbRoomManageErr");
    if (e) e.style.display = "none";
  }
  function setChatStatus(t) {
    var s = $("#gbRoomMeta");
    if (s) s.textContent = t;
  }

  function openModal(id) { var m = $(id); if (m) m.style.display = "flex"; }
  function closeModal(id) { var m = $(id); if (m) m.style.display = "none"; }

  /* ---------------- 消息渲染 ---------------- */
  function renderMsgs(arr) {
    if (!box || !arr || !arr.length) return;
    var me = getUser();
    var html = arr.map(function (m) {
      var mine = me && m.username === me.name;
      return '<div class="gb-chat-row' + (mine ? " mine" : "") + '">' +
        "<b>" + esc(m.username) + "</b>" +
        '<span class="gb-chat-time">' + esc(fmtTime(m.created_at)) + "</span>" +
        "<p>" + esc(m.content) + "</p></div>";
    }).join("");
    box.insertAdjacentHTML("beforeend", html);
  }

  /* ---------------- 房间列表（顶部固定大厅入口） ---------------- */
  function renderRooms() {
    var listEl = $("#gbRoomList");
    if (!listEl) return;
    var isLobby = current && current.room_no === 0;
    var lobbyHtml = '<div class="gb-room-item gb-lobby-item' + (isLobby ? " active" : "") + '" data-no="0" role="button" tabindex="0">' +
        '<span class="gb-room-no">0</span>' +
        '<div class="gb-room-info">' +
          '<div class="gb-room-name">大厅</div>' +
          '<div class="gb-room-meta">公共聊天 · 所有用户可见</div>' +
        "</div></div>";
    var html = lobbyHtml;
    if (!rooms.length) {
      html += '<div class="gb-empty">暂无房间，点击上方"创建房间"开启第一间～</div>';
    } else {
      html += rooms.map(function (r) {
        var isCur = current && current.room_no === r.room_no;
        return '<div class="gb-room-item' + (isCur ? " active" : "") + '" data-no="' + r.room_no + '" role="button" tabindex="0">' +
          '<span class="gb-room-no">' + r.room_no + "</span>" +
          '<div class="gb-room-info">' +
            '<div class="gb-room-name">' + esc(r.name) + (r.has_pass ? '<span class="gb-room-lock" title="密码房">密</span>' : "") + "</div>" +
            '<div class="gb-room-meta">成员 ' + r.member_count + " · 房主 " + esc(r.owner_name || "?") + "</div>" +
          "</div></div>";
      }).join("");
    }
    listEl.innerHTML = html;
    var lobbyEl = listEl.querySelector('[data-no="0"]');
    if (lobbyEl) lobbyEl.addEventListener("click", enterLobby);
    Array.prototype.forEach.call(listEl.querySelectorAll('.gb-room-item[data-no]:not([data-no="0"])'), function (el) {
      el.addEventListener("click", function () {
        var no = Number(el.getAttribute("data-no"));
        for (var i = 0; i < rooms.length; i++) {
          if (rooms[i].room_no === no) { enterRoom(rooms[i]); break; }
        }
      });
    });
  }

  function loadRooms() {
    window.GB_API.roomList()
      .then(function (data) {
        rooms = (data && Array.isArray(data.list)) ? data.list : [];
        renderRooms();
      })
      .catch(function () { /* 列表轮询失败静默，下轮重试 */ });
  }

  /* ---------------- 进入 / 离开房间 ---------------- */
  function enterRoom(room) {
    if (!room || !room.room_no) return;
    if (current && current.room_no === room.room_no) return;
    requireLogin(function () {
      hideErr();
      window.GB_API.roomJoin(room.room_no)
        .then(function () { enterRoomAfterJoin(room); })
        .catch(function (err) {
          if (err && err.status === 403) {
            openJoinModal(room); /* 密码房：弹密码框 */
          } else {
            showErr("加入失败：" + (err && err.message ? err.message : "网络异常"));
          }
        });
    });
  }

  function enterRoomAfterJoin(room) {
    stopChatTimer();
    current = room;
    lastId = 0;
    var me = getUser();
    isOwner = !!(me && room.owner_name && me.name && room.owner_name === me.name);
    var title = $("#gbRoomTitle");
    if (title) title.textContent = (room.name ? room.name : "房间 " + room.room_no) + "  #" + room.room_no;
    setChatStatus((room.has_pass ? "密码房 · " : "公开房 · ") + "房主 " + (room.owner_name || "?"));
    var mgr = $("#gbRoomManageBtn");
    if (mgr) mgr.style.display = isOwner ? "inline-block" : "none";
    var leave = $("#gbRoomLeaveBtn");
    if (leave) leave.style.display = "inline-block";
    box.innerHTML = '<div class="gb-empty">正在加载聊天记录…</div>';
    renderRooms();
    loadRoomMessages();
  }

  function leaveRoom() {
    stopChatTimer();
    current = null;
    isOwner = false;
    lastId = 0;
    var t = $("#gbRoomTitle");
    if (t) t.textContent = "尚未加入房间";
    setChatStatus("从左侧选择房间，或创建 / 按房间号加入");
    var mgr = $("#gbRoomManageBtn");
    if (mgr) mgr.style.display = "none";
    var leave = $("#gbRoomLeaveBtn");
    if (leave) leave.style.display = "inline-block";
    box.innerHTML = '<div class="gb-empty">从左侧选择一个房间加入，或创建 / 按房间号加入。</div>';
    renderRooms();
  }

  /* ---------------- 大厅（房间号 0，走 /api/chat） ---------------- */
  function enterLobby() {
    if (current && current.room_no === 0) return;
    requireLogin(function () {
      hideErr();
      stopChatTimer();
      current = { room_no: 0, name: "大厅", lobby: true, has_pass: false, owner_name: "" };
      lastId = 0;
      isOwner = false;
      var title = $("#gbRoomTitle");
      if (title) title.textContent = "大厅  #0";
      setChatStatus("公共聊天 · 所有用户可见");
      var mgr = $("#gbRoomManageBtn");
      if (mgr) mgr.style.display = "none";
      var leave = $("#gbRoomLeaveBtn");
      if (leave) leave.style.display = "none";
      box.innerHTML = '<div class="gb-empty">正在加载大厅消息…</div>';
      renderRooms();
      loadLobbyMessages();
    });
  }

  function loadLobbyMessages() {
    if (!current || current.room_no !== 0) return;
    hideErr();
    setChatStatus("连接中…");
    window.GB_API.listChat()
      .then(function (data) {
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        lastId = (data && data.last != null) ? data.last : 0;
        box.innerHTML = list.length ? "" : '<div class="gb-empty">大厅还很安静，来聊第一句吧～</div>';
        renderMsgs(list);
        box.scrollTop = box.scrollHeight;
        setChatStatus("公共聊天 · 在线");
        startChatTimer();
      })
      .catch(function (err) {
        setChatStatus("加载失败");
        box.innerHTML = '<div class="gb-empty">消息加载失败：' + esc(err && err.message ? err.message : "网络异常") + "</div>";
      });
  }

  function pollLobby() {
    if (!current || current.room_no !== 0) return;
    window.GB_API.listChat(lastId)
      .then(function (data) {
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        if (!list.length) return;
        if (data.last != null) lastId = data.last;
        var wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
        var hadEmpty = box.querySelector(".gb-empty");
        if (hadEmpty) hadEmpty.remove();
        renderMsgs(list);
        if (wasBottom) box.scrollTop = box.scrollHeight;
      })
      .catch(function () { /* 大厅轮询失败静默，下轮重试 */ });
  }

  /* ---------------- 房间消息 ---------------- */
  function loadRoomMessages() {
    if (!current) return;
    hideErr();
    setChatStatus("连接中…");
    window.GB_API.roomMessages(current.room_no)
      .then(function (data) {
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        lastId = (data && data.last != null) ? data.last : 0;
        box.innerHTML = list.length ? "" : '<div class="gb-empty">房间还很安静，来聊第一句吧～</div>';
        renderMsgs(list);
        box.scrollTop = box.scrollHeight;
        setChatStatus((current.has_pass ? "密码房 · " : "公开房 · ") + "房主 " + (current.owner_name || "?") + " · 在线");
        startChatTimer();
      })
      .catch(function (err) {
        setChatStatus("加载失败");
        box.innerHTML = '<div class="gb-empty">消息加载失败：' + esc(err && err.message ? err.message : "网络异常") + "</div>";
      });
  }

  function pollRoom() {
    if (!current) return;
    window.GB_API.roomMessages(current.room_no, lastId)
      .then(function (data) {
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        if (!list.length) return;
        if (data.last != null) lastId = data.last;
        var wasBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
        var hadEmpty = box.querySelector(".gb-empty");
        if (hadEmpty) hadEmpty.remove();
        renderMsgs(list);
        if (wasBottom) box.scrollTop = box.scrollHeight;
      })
      .catch(function (err) {
        if (err && (err.status === 403 || err.status === 404)) {
          /* 已被踢出或房间已解散 */
          stopChatTimer();
          showErr(err.message || "你已离开该房间");
          leaveRoom();
          loadRooms();
        }
      });
  }

  function startChatTimer() {
    if (chatTimer) return;
    chatTimer = setInterval(function () { if (current) pollRoom(); }, 5000);
  }
  function stopChatTimer() {
    if (chatTimer) { clearInterval(chatTimer); chatTimer = null; }
  }

  /* ---------------- 发送 ---------------- */
  function send() {
    if (!current) { showErr("请先加入一个房间或进入大厅再发言"); return; }
    var input = $("#gbChatText");
    var content = (input ? input.value : "").trim();
    hideErr();
    if (!content) return;
    if (content.length > 300) { showErr("消息不能超过 300 字。"); return; }
    if (!window.GB_API.isLoggedIn()) { requireLogin(function () { send(); }); return; }
    var p = (current.room_no === 0)
      ? window.GB_API.postChat(content)
      : window.GB_API.roomSend(current.room_no, content);
    p.then(function () {
        if (input) input.value = "";
        setTimeout(function () { if (current && current.room_no === 0) pollLobby(); else pollRoom(); }, 300);
      })
      .catch(function (err) {
        if (err && err.status === 401) { requireLogin(function () { send(); }); return; }
        showErr("发送失败：" + (err && err.message ? err.message : "网络异常"));
      });
  }

  /* ---------------- 创建房间 ---------------- */
  function openCreate() {
    var e = $("#gbRoomCreateErr");
    if (e) e.style.display = "none";
    var n = $("#gbRoomCreateName");
    if (n) n.value = "";
    var p = $("#gbRoomCreatePass");
    if (p) p.value = "";
    openModal("#gbRoomCreateModal");
    if (n) n.focus();
  }

  function doCreate() {
    var errEl = $("#gbRoomCreateErr");
    if (errEl) errEl.style.display = "none";
    var name = $("#gbRoomCreateName").value.trim();
    var pass = $("#gbRoomCreatePass").value;
    if (!name) {
      if (errEl) { errEl.textContent = "请填写房间名（1-20 字）"; errEl.style.display = "block"; }
      return;
    }
    if (!window.GB_API.isLoggedIn()) { requireLogin(openCreate); return; }
    window.GB_API.roomCreate(name, pass)
      .then(function (data) {
        closeModal("#gbRoomCreateModal");
        loadRooms();
        if (data && data.room) enterRoomAfterJoin(data.room);
      })
      .catch(function (err) {
        if (errEl) {
          errEl.textContent = "创建失败：" + (err && err.message ? err.message : "网络异常");
          errEl.style.display = "block";
        }
      });
  }

  /* ---------------- 按房间号加入 / 密码房 ---------------- */
  function doJoinByNo() {
    var input = $("#gbRoomSearch");
    var no = Number((input ? input.value : "").trim());
    hideErr();
    if (!no || no <= 0) { showErr("请输入有效的房间号"); return; }
    requireLogin(function () {
      window.GB_API.roomJoin(no)
        .then(function () {
          enterRoomAfterJoin({ room_no: no, name: "房间 " + no, has_pass: false, owner_name: "" });
          loadRooms();
        })
        .catch(function (err) {
          if (err && err.status === 403) {
            openJoinModal({ room_no: no, name: "房间 " + no, has_pass: true });
          } else {
            showErr("加入失败：" + (err && err.message ? err.message : "网络异常"));
          }
        });
    });
  }

  function openJoinModal(room) {
    var noEl = $("#gbRoomJoinNo");
    if (noEl) noEl.textContent = "#" + room.room_no;
    var p = $("#gbRoomJoinPass");
    if (p) p.value = "";
    var e = $("#gbRoomJoinErr");
    if (e) e.style.display = "none";
    openModal("#gbRoomJoinModal");
    if (p) p.focus();
  }

  function doJoin() {
    var errEl = $("#gbRoomJoinErr");
    if (errEl) errEl.style.display = "none";
    var noText = $("#gbRoomJoinNo").textContent || "";
    var no = Number(noText.replace("#", ""));
    var pass = $("#gbRoomJoinPass").value;
    window.GB_API.roomJoin(no, pass)
      .then(function () {
        closeModal("#gbRoomJoinModal");
        enterRoomAfterJoin({ room_no: no, name: "房间 " + no, has_pass: true, owner_name: "" });
        loadRooms();
      })
      .catch(function (err) {
        if (errEl) {
          errEl.textContent = "加入失败：" + (err && err.message ? err.message : "网络异常");
          errEl.style.display = "block";
        }
      });
  }

  /* ---------------- 房主管理 ---------------- */
  function openManage() {
    if (!current) return;
    var noEl = $("#gbRoomManageNo");
    if (noEl) noEl.textContent = "#" + current.room_no;
    var n = $("#gbRoomSetName");
    if (n) n.value = (current.name && current.name !== ("房间 " + current.room_no)) ? current.name : "";
    var p = $("#gbRoomSetPass");
    if (p) p.value = "";
    var e = $("#gbRoomManageErr");
    if (e) e.style.display = "none";
    var ok = $("#gbRoomManageOk");
    if (ok) ok.style.display = "none";
    openModal("#gbRoomManageModal");
    loadMembers();
  }

  function loadMembers() {
    if (!current) return;
    var el = $("#gbRoomMembers");
    if (!el) return;
    el.innerHTML = '<div class="gb-empty">正在加载成员…</div>';
    window.GB_API.roomMembers(current.room_no)
      .then(function (data) {
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        if (!list.length) { el.innerHTML = '<div class="gb-empty">暂无成员</div>'; return; }
        var me = getUser();
        var html = list.map(function (m) {
          var self = me && me.name && m.username === me.name;
          return '<div class="gb-room-member">' +
            '<span class="gb-room-member-name">' + esc(m.username) + (self ? "（我）" : "") + "</span>" +
            '<span class="gb-room-member-time">' + esc(fmtTime(m.joined_at)) + " 加入</span>" +
            (self ? "" : '<button class="btn btn-danger btn-sm" data-kick="' + m.user_id + '">踢出</button>') +
            "</div>";
        }).join("");
        el.innerHTML = html;
        Array.prototype.forEach.call(el.querySelectorAll("[data-kick]"), function (btn) {
          btn.addEventListener("click", function () {
            if (!window.confirm("确定将该成员踢出房间？")) return;
            window.GB_API.roomKick(current.room_no, Number(btn.getAttribute("data-kick")))
              .then(function () { showManageOk("已踢出成员"); loadMembers(); })
              .catch(function (err) { showManageErr("踢人失败：" + (err && err.message ? err.message : "网络异常")); });
          });
        });
      })
      .catch(function () { el.innerHTML = '<div class="gb-empty">成员加载失败</div>'; });
  }

  function doSet() {
    if (!current) return;
    var name = $("#gbRoomSetName").value.trim();
    var pass = $("#gbRoomSetPass").value;
    if (!name && !pass) { showManageErr("没有需要保存的修改"); return; }
    if (pass && (pass.length < 4 || pass.length > 20)) { showManageErr("密码需 4-20 位，留空表示取消密码"); return; }
    var patch = {};
    if (name) patch.name = name;
    if (pass) patch.password = pass;
    window.GB_API.roomUpdate(current.room_no, patch)
      .then(function () {
        showManageOk("房间设置已保存");
        if (name) current.name = name;
        var t = $("#gbRoomTitle");
        if (t) t.textContent = (current.name ? current.name : "房间 " + current.room_no) + "  #" + current.room_no;
        loadRooms();
      })
      .catch(function (err) { showManageErr("保存失败：" + (err && err.message ? err.message : "网络异常")); });
  }

  function doDissolve() {
    if (!current) return;
    if (!window.confirm("确定解散房间 #" + current.room_no + "？该房间及其聊天记录将被永久删除。")) return;
    window.GB_API.roomDissolve(current.room_no)
      .then(function () {
        closeModal("#gbRoomManageModal");
        showErr("房间已解散");
        leaveRoom();
        loadRooms();
      })
      .catch(function (err) { showManageErr("解散失败：" + (err && err.message ? err.message : "网络异常")); });
  }

  function doLeave() {
    if (!current || current.room_no === 0) return; /* 大厅无退出概念，按钮已隐藏 */
    if (isOwner) { showErr("你是房主，请通过「管理房间」解散或调整房间"); return; }
    window.GB_API.roomLeave(current.room_no)
      .then(function () {
        showErr("已退出房间");
        leaveRoom();
        loadRooms();
      })
      .catch(function (err) { showErr("退出失败：" + (err && err.message ? err.message : "网络异常")); });
  }

  /* ---------------- 初始化 ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    box = $("#gbChatBox");

    var createBtn = $("#gbRoomCreateBtn");
    if (createBtn) createBtn.addEventListener("click", openCreate);
    var createOk = $("#gbRoomCreateOk");
    if (createOk) createOk.addEventListener("click", doCreate);
    var joinBtn = $("#gbRoomJoinBtn");
    if (joinBtn) joinBtn.addEventListener("click", doJoinByNo);
    var searchInput = $("#gbRoomSearch");
    if (searchInput) searchInput.addEventListener("keydown", function (e) { if (e.key === "Enter") doJoinByNo(); });
    var joinOk = $("#gbRoomJoinOk");
    if (joinOk) joinOk.addEventListener("click", doJoin);
    var manageBtn = $("#gbRoomManageBtn");
    if (manageBtn) manageBtn.addEventListener("click", openManage);
    var setOk = $("#gbRoomSetOk");
    if (setOk) setOk.addEventListener("click", doSet);
    var dissolveBtn = $("#gbRoomDissolveBtn");
    if (dissolveBtn) dissolveBtn.addEventListener("click", doDissolve);
    var leaveBtn = $("#gbRoomLeaveBtn");
    if (leaveBtn) leaveBtn.addEventListener("click", doLeave);

    var sendBtn = $("#gbChatSend");
    if (sendBtn) sendBtn.addEventListener("click", send);
    var input = $("#gbChatText");
    if (input) input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") send();
    });

    /* 弹窗关闭 */
    Array.prototype.forEach.call(document.querySelectorAll("[data-close]"), function (btn) {
      btn.addEventListener("click", function () {
        closeModal("#" + btn.getAttribute("data-close"));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".gb-modal-mask"), function (mask) {
      mask.addEventListener("click", function (e) {
        if (e.target === mask) mask.style.display = "none";
      });
    });

    loadRooms();
    roomTimer = setInterval(loadRooms, 15000);
  });
})();
