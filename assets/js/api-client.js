/* =========================================================
   顾手游电竞 · 云端 API 客户端（Cloudflare Worker）
   接口地址：https://api.gushouyou.top（完整规格见 worker.js）
   会话：token 存 localStorage(gb_token)、user 存 gb_user
   所有请求自动带 Authorization: Bearer；非 2xx 抛 Error(error)
   ========================================================= */
(function () {
  "use strict";

  var BASE = "https://api.gushouyou.top";
  var K_TOKEN = "gb_token";
  var K_USER = "gb_user";
  var tokenGetter = null;

  /* 兼容后台：可用 GB_API.setTokenGetter 注入自定义 token 来源（如 sessionStorage） */
  function readToken() {
    if (tokenGetter) {
      var t = tokenGetter();
      if (t) return t;
    }
    try { return localStorage.getItem(K_TOKEN); } catch (e) { return null; }
  }

  function request(method, path, body) {
    var headers = { "Content-Type": "application/json" };
    var token = readToken();
    if (token) headers["Authorization"] = "Bearer " + token;
    var opts = { method: method, headers: headers };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(BASE + path, opts).then(function (res) {
      if (res.status === 204) return {};
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var err = new Error(data.error || ("请求失败（" + res.status + "）"));
          err.status = res.status;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  }

  window.GB_API = {
    BASE: BASE,

    /* 会话管理 */
    setTokenGetter: function (fn) { tokenGetter = fn; },
    getToken: readToken,
    setToken: function (token) { try { localStorage.setItem(K_TOKEN, token); } catch (e) {} },
    getUser: function () {
      try { return JSON.parse(localStorage.getItem(K_USER) || "null"); }
      catch (e) { return null; }
    },
    setUser: function (user) {
      try {
        if (user) localStorage.setItem(K_USER, JSON.stringify(user));
        else localStorage.removeItem(K_USER);
      } catch (e) {}
    },
    isLoggedIn: function () { return !!readToken(); },
    logout: function () {
      try { localStorage.removeItem(K_TOKEN); localStorage.removeItem(K_USER); } catch (e) {}
    },

    /* 账号 */
    register: function (username, password, invite) {
      return request("POST", "/api/register", { username: username, password: password, invite: invite || "" });
    },
    login: function (username, password) {
      return request("POST", "/api/login", { username: username, password: password });
    },

    /* 订单 */
    createOrder: function (item, price, note) {
      return request("POST", "/api/orders", { item: item, price: price, note: note });
    },
    myOrders: function () { return request("GET", "/api/orders"); },
    adminOrders: function () { return request("GET", "/api/orders/admin"); },
    updateOrderStatus: function (id, status) {
      return request("POST", "/api/orders/" + id, { status: status });
    },

    /* 留言 */
    listMessages: function () { return request("GET", "/api/messages"); },
    postMessage: function (content) { return request("POST", "/api/messages", { content: content }); },
    deleteMessage: function (id) { return request("DELETE", "/api/messages/" + id); },

    /* 聊天（大厅，保持不变） */
    listChat: function (after) {
      return request("GET", "/api/chat" + (after ? "?after=" + Number(after) : ""));
    },
    postChat: function (content) { return request("POST", "/api/chat", { content: content }); },

    /* 房间（KOOK 风格房间制聊天室） */
    roomList: function () { return request("GET", "/api/rooms"); },
    roomCreate: function (name, password) {
      return request("POST", "/api/rooms", { name: name, password: password || "" });
    },
    roomJoin: function (roomNo, password) {
      return request("POST", "/api/rooms/join", { roomNo: Number(roomNo), password: password || "" });
    },
    roomLeave: function (roomNo) {
      return request("POST", "/api/rooms/leave", { roomNo: Number(roomNo) });
    },
    roomMessages: function (roomNo, after) {
      return request("GET", "/api/rooms/" + Number(roomNo) + "/messages" + (after ? "?after=" + Number(after) : ""));
    },
    roomSend: function (roomNo, content) {
      return request("POST", "/api/rooms/" + Number(roomNo) + "/messages", { content: content });
    },
    roomUpdate: function (roomNo, patch) {
      return request("PUT", "/api/rooms/" + Number(roomNo), patch || {});
    },
    roomDissolve: function (roomNo) {
      return request("DELETE", "/api/rooms/" + Number(roomNo));
    },
    roomKick: function (roomNo, userId) {
      return request("POST", "/api/rooms/" + Number(roomNo) + "/kick", { user_id: Number(userId) });
    },
    roomMembers: function (roomNo) {
      return request("GET", "/api/rooms/" + Number(roomNo) + "/members");
    },

    /* 3.1 数字 ID / 语音模式（V2，KOOK 风格） */
    luckyIds: function () {
      return request("GET", "/api/lucky-ids");
    },
    voiceJoin: function (roomNo) {
      return request("POST", "/api/rooms/" + Number(roomNo) + "/voice/join", {});
    },
    voiceLeave: function (roomNo) {
      return request("POST", "/api/rooms/" + Number(roomNo) + "/voice/leave", {});
    },
    voiceMic: function (roomNo, micOn) {
      return request("POST", "/api/rooms/" + Number(roomNo) + "/voice/mic", { mic_on: !!micOn });
    },
    voicePeers: function (roomNo) {
      return request("GET", "/api/rooms/" + Number(roomNo) + "/voice/peers");
    },
    signalSend: function (roomNo, toUserId, data) {
      return request("POST", "/api/rooms/" + Number(roomNo) + "/signal", { to_user_id: Number(toUserId), data: data });
    },
    signalPoll: function (roomNo, since) {
      return request("GET", "/api/rooms/" + Number(roomNo) + "/signal" + (since ? "?since=" + Number(since) : ""));
    },

    /* 内容 */
    getContent: function () { return request("GET", "/api/content"); },
    saveContent: function (key, value) {
      return request("POST", "/api/content", { key: key, value: value });
    },
    deleteContent: function (key) {
      return request("DELETE", "/api/content/" + encodeURIComponent(key));
    },

    /* 图片（Worker 存 KV：上传 / 列表 / 删除 / 直链） */
    uploadImage: function (file) {
      return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(file.type)) { reject(new Error("请选择图片文件")); return; }
        if (file.size > 2 * 1024 * 1024) { reject(new Error("图片超过 2MB 限制")); return; }
        var reader = new FileReader();
        reader.onerror = function () { reject(new Error("读取文件失败")); };
        reader.onload = function () {
          var data = String(reader.result || "");
          if (data.length > 2.9 * 1024 * 1024) { reject(new Error("图片超过 2MB 限制")); return; }
          request("POST", "/api/upload", { filename: file.name || "image.png", data: data, type: file.type || "" })
            .then(resolve, reject);
        };
        reader.readAsDataURL(file);
      });
    },
    listImages: function () { return request("GET", "/api/images"); },
    deleteImage: function (key) {
      return request("DELETE", "/api/img/" + encodeURIComponent(key));
    },
    imageUrl: function (key) { return BASE + "/api/img/" + encodeURIComponent(key); },

    /* 聊天室管理（admin，仅 role=admin 可调用） */
    adminListUsers: function () { return request("GET", "/api/admin/users"); },
    adminUpdateUser: function (id, patch) {
      return request("POST", "/api/admin/users/" + Number(id), patch || {});
    },
    adminSetRole: function (id, role) {
      return request("POST", "/api/admin/users/" + Number(id) + "/role", { role: role });
    },
    adminListRooms: function () { return request("GET", "/api/admin/rooms"); },
    adminCreateRoom: function (name, password, ownerUserId) {
      return request("POST", "/api/admin/rooms", {
        name: name,
        password: password || "",
        owner_user_id: ownerUserId ? Number(ownerUserId) : undefined
      });
    },
    adminUpdateRoom: function (roomNo, patch) {
      return request("PUT", "/api/admin/rooms/" + Number(roomNo), patch || {});
    },
    adminDissolveRoom: function (roomNo) {
      return request("DELETE", "/api/admin/rooms/" + Number(roomNo));
    }
  };
})();
