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

    /* 聊天 */
    listChat: function (after) {
      return request("GET", "/api/chat" + (after ? "?after=" + Number(after) : ""));
    },
    postChat: function (content) { return request("POST", "/api/chat", { content: content }); },

    /* 内容 */
    getContent: function () { return request("GET", "/api/content"); },
    saveContent: function (key, value) {
      return request("POST", "/api/content", { key: key, value: value });
    },
    deleteContent: function (key) {
      return request("DELETE", "/api/content/" + encodeURIComponent(key));
    }
  };
})();
