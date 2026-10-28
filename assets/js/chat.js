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
    if (voice.joined) leaveVoice();
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
    voiceVisible(true);
    updateVoiceUi();
    box.innerHTML = '<div class="gb-empty">正在加载聊天记录…</div>';
    renderRooms();
    loadRoomMessages();
  }

  function leaveRoom() {
    if (voice.joined) leaveVoice();
    voiceVisible(false);
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

  /* =========================================================
     语音模式（V2，WebRTC mesh + KOOK 风格）
     - 进入语音：voiceJoin 登记 + getUserMedia 采集麦克风
     - mesh：与每个在线成员建立 RTCPeerConnection
     - 信令：POST/GET /signal 轮询转发 offer/answer/ice
     - 开麦/闭麦：本地 track.enabled + API 广播 mic_on
     - 成员列表：昵称 + #数字ID + 麦克风图标，房主 👑
     - 联动清理：退出房间/解散/踢人时统一离开语音
     ========================================================= */
  var voice = {
    joined: false,
    stream: null,
    peers: {},          /* userId -> RTCPeerConnection */
    micOn: true,
    sigTimer: null,
    peerTimer: null,
    sigSince: 0
  };

  function voiceVisible(v) {
    var bar = $("#gbVoiceBar");
    if (bar) bar.style.display = v ? "inline-flex" : "none";
    var panel = $("#gbVoicePanel");
    if (panel) panel.style.display = v ? "flex" : "none";
  }

  function updateVoiceUi() {
    var joinBtn = $("#gbVoiceJoinBtn");
    var micBtn = $("#gbVoiceMicBtn");
    var leaveBtn = $("#gbVoiceLeaveBtn");
    if (!joinBtn || !micBtn || !leaveBtn) return;
    if (!voice.joined) {
      joinBtn.style.display = "inline-block";
      micBtn.style.display = "none";
      leaveBtn.style.display = "none";
    } else {
      joinBtn.style.display = "none";
      micBtn.style.display = "inline-block";
      leaveBtn.style.display = "inline-block";
      micBtn.textContent = voice.micOn ? "🎤 开麦" : "🔇 闭麦";
      micBtn.className = "gb-voice-btn " + (voice.micOn ? "gb-voice-mic-on" : "gb-voice-mic-off");
    }
  }

  function renderVoiceMembers(list) {
    var el = $("#gbVoiceMembers");
    if (!el) return;
    if (!list || !list.length) {
      el.innerHTML = '<span class="gb-empty">语音频道空无一人，来占个麦位～</span>';
      return;
    }
    var me = getUser();
    var ownerName = current ? current.owner_name : "";
    var html = list.map(function (m) {
      var isMe = me && Number(m.user_id) === Number(me.id);
      var micCls = m.mic_on ? "on" : "off";
      var micIcon = m.mic_on ? "🎤" : "🔇";
      var crown = (ownerName && m.username === ownerName) ? '<span class="gb-voice-crown" title="房主">👑</span>' : "";
      var selfTag = isMe ? '<span class="gb-voice-self">我</span>' : "";
      return '<div class="gb-voice-member' + (isMe ? " me" : "") + '">' +
        '<span class="gb-voice-avatar">' + esc(String(m.username || "?").charAt(0).toUpperCase()) + "</span>" +
        '<span class="gb-voice-info">' +
          '<span class="gb-voice-name">' + esc(m.username || "?") + selfTag + crown + "</span>" +
          '<span class="gb-voice-did">#' + esc(m.digital_id != null ? String(m.digital_id) : "?") + "</span>" +
        "</span>" +
        '<span class="gb-voice-mic ' + micCls + '" title="' + (m.mic_on ? "已开麦" : "已闭麦") + '">' + micIcon + "</span>" +
        "</div>";
    }).join("");
    el.innerHTML = html;
  }

  function sendSignal(toUserId, data) {
    if (!current || current.room_no === 0) return;
    window.GB_API.signalSend(current.room_no, toUserId, data).catch(function () { /* 信令失败静默 */ });
  }

  function ensurePc(userId) {
    if (voice.peers[userId]) return voice.peers[userId];
    var pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    voice.peers[userId] = pc;
    if (voice.stream) {
      voice.stream.getTracks().forEach(function (t) {
        try { pc.addTrack(t, voice.stream); } catch (e) {}
      });
    }
    pc.onicecandidate = function (ev) {
      if (!ev.candidate) return;
      sendSignal(userId, { type: "ice", candidate: ev.candidate });
    };
    pc.ontrack = function () { /* 远端音频自动播放，无需显式渲染 */ };
    return pc;
  }

  function offerTo(userId) {
    var pc = ensurePc(userId);
    pc.createOffer()
      .then(function (offer) { return pc.setLocalDescription(offer); })
      .then(function () { sendSignal(userId, { type: "offer", sdp: pc.localDescription }); })
      .catch(function () { /* glare/失败静默，成员轮询下轮补偿 */ });
  }

  function handleSignal(sig) {
    if (!sig || sig.from_user_id == null) return;
    var from = Number(sig.from_user_id);
    var data = sig.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (e) { return; }
    }
    if (!data || !data.type) return;
    if (data.type === "offer") {
      var pc = ensurePc(from);
      pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: data.sdp }))
        .then(function () { return pc.createAnswer(); })
        .then(function (answer) { return pc.setLocalDescription(answer); })
        .then(function () { sendSignal(from, { type: "answer", sdp: pc.localDescription }); })
        .catch(function () { /* 处理失败静默 */ });
    } else if (data.type === "answer") {
      var pc2 = voice.peers[from];
      if (pc2) pc2.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: data.sdp })).catch(function () {});
    } else if (data.type === "ice") {
      var pc3 = voice.peers[from];
      if (pc3 && data.candidate) pc3.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function () {});
    }
  }

  function pollSignals() {
    if (!voice.joined || !current || current.room_no === 0) return;
    window.GB_API.signalPoll(current.room_no, voice.sigSince)
      .then(function (data) {
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        list.forEach(function (s) {
          if (s.at > voice.sigSince) voice.sigSince = s.at;
          handleSignal(s);
        });
      })
      .catch(function () { /* 信令轮询失败静默 */ });
  }

  function pollVoiceMembers() {
    if (!voice.joined || !current || current.room_no === 0) return;
    window.GB_API.voicePeers(current.room_no)
      .then(function (data) {
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        renderVoiceMembers(list);
        var me = getUser();
        var meId = me ? Number(me.id) : -1;
        list.forEach(function (m) {
          var uid = Number(m.user_id);
          if (uid === meId) return;
          if (!voice.peers[uid]) offerTo(uid);
        });
      })
      .catch(function () { /* 成员轮询失败静默（解散/被踢时由消息轮询兜底） */ });
  }

  function startVoiceTimers() {
    if (voice.sigTimer) return;
    voice.sigTimer = setInterval(pollSignals, 2000);
    voice.peerTimer = setInterval(pollVoiceMembers, 5000);
  }
  function stopVoiceTimers() {
    if (voice.sigTimer) { clearInterval(voice.sigTimer); voice.sigTimer = null; }
    if (voice.peerTimer) { clearInterval(voice.peerTimer); voice.peerTimer = null; }
  }

  function joinVoice() {
    if (voice.joined) return;
    if (!current || current.room_no === 0) { showErr("请先加入房间再进入语音"); return; }
    if (!window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showErr("当前浏览器不支持 WebRTC 语音，请使用新版 Chrome / Edge"); return;
    }
    requireLogin(function () {
      window.GB_API.voiceJoin(current.room_no)
        .then(function (data) {
          voice.joined = true;
          voice.micOn = true;
          voice.sigSince = 0;
          return navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            .then(function (stream) {
              voice.stream = stream;
              var list = (data && Array.isArray(data.peers)) ? data.peers : [];
              var me = getUser();
              var meId = me ? Number(me.id) : -1;
              list.forEach(function (m) {
                var uid = Number(m.user_id);
                if (uid === meId) return;
                offerTo(uid);
              });
              startVoiceTimers();
              updateVoiceUi();
              pollVoiceMembers();
            });
        })
        .catch(function (err) {
          voice.joined = false;
          /* 后端可能已登记，尝试离开清理 */
          if (current && current.room_no !== 0) window.GB_API.voiceLeave(current.room_no).catch(function () {});
          showErr("进入语音失败：" + (err && err.message ? err.message : "请检查麦克风权限"));
        });
    });
  }

  function toggleMic() {
    if (!voice.joined) return;
    voice.micOn = !voice.micOn;
    if (voice.stream) {
      voice.stream.getAudioTracks().forEach(function (t) {
        try { t.enabled = voice.micOn; } catch (e) {}
      });
    }
    if (current && current.room_no !== 0) window.GB_API.voiceMic(current.room_no, voice.micOn).catch(function () {});
    updateVoiceUi();
  }

  function leaveVoice() {
    if (!voice.joined) return;
    stopVoiceTimers();
    Object.keys(voice.peers).forEach(function (uid) {
      try { voice.peers[uid].close(); } catch (e) {}
    });
    voice.peers = {};
    if (voice.stream) {
      voice.stream.getTracks().forEach(function (t) {
        try { t.stop(); } catch (e) {}
      });
      voice.stream = null;
    }
    voice.joined = false;
    voice.micOn = true;
    voice.sigSince = 0;
    if (current && current.room_no !== 0) window.GB_API.voiceLeave(current.room_no).catch(function () {});
    updateVoiceUi();
    var el = $("#gbVoiceMembers");
    if (el) el.innerHTML = '<span class="gb-empty">语音频道空无一人，来占个麦位～</span>';
  }

  /* ---------------- 靓号中心（占位） ---------------- */
  function openLucky() {
    var err = $("#gbLuckyErr");
    if (err) err.style.display = "none";
    var ok = $("#gbLuckyOk");
    if (ok) ok.style.display = "none";
    var cur = $("#gbLuckyCur");
    if (cur) {
      var user = getUser();
      cur.innerHTML = (user && user.digital_id != null)
        ? "#" + esc(String(user.digital_id))
        : '<span class="gp-empty">登录后查看</span>';
    }
    openModal("#gbLuckyModal");
    loadLuckyIds();
  }

  function loadLuckyIds() {
    var el = $("#gbLuckyList");
    if (!el) return;
    el.innerHTML = "正在加载靓号…";
    window.GB_API.luckyIds()
      .then(function (data) {
        var list = (data && Array.isArray(data.list)) ? data.list : [];
        if (!list.length) { el.innerHTML = '<span class="gb-empty">暂无靓号资源</span>'; return; }
        el.innerHTML = list.map(function (x) {
          return '<div class="gb-lucky-item">' +
            '<span class="gb-lucky-no">#' + esc(String(x.digital_id)) + "</span>" +
            '<span class="gb-lucky-tag">' + esc(x.tag || x.level || "靓号") + "</span>" +
            "</div>";
        }).join("");
      })
      .catch(function () { el.innerHTML = '<span class="gb-empty">靓号加载失败</span>'; });
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

    /* 语音按钮组 */
    var voiceJoinBtn = $("#gbVoiceJoinBtn");
    if (voiceJoinBtn) voiceJoinBtn.addEventListener("click", joinVoice);
    var voiceMicBtn = $("#gbVoiceMicBtn");
    if (voiceMicBtn) voiceMicBtn.addEventListener("click", toggleMic);
    var voiceLeaveBtn = $("#gbVoiceLeaveBtn");
    if (voiceLeaveBtn) voiceLeaveBtn.addEventListener("click", leaveVoice);

    /* 靓号中心 */
    var luckyBtn = $("#gbLuckyBtn");
    if (luckyBtn) luckyBtn.addEventListener("click", openLucky);

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

  /* 页面关闭时兜底清理语音连接 */
  window.addEventListener("beforeunload", function () {
    if (voice.joined) {
      try { stopVoiceTimers(); } catch (e) {}
      Object.keys(voice.peers).forEach(function (uid) {
        try { voice.peers[uid].close(); } catch (e) {}
      });
      if (voice.stream) {
        voice.stream.getTracks().forEach(function (t) {
          try { t.stop(); } catch (e) {}
        });
      }
    }
  });
})();
