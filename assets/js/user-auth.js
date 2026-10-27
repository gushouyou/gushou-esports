/* =========================================================
   顾手游电竞 · 前台用户区组件
   功能：#userArea 登录/注册按钮、登录/注册模态框、我的订单模态框
   依赖：api-client.js（window.GB_API）
   ========================================================= */
(function () {
  "use strict";

  var A = window.GB_API;

  var STATUS_MAP = { pending: "待处理", done: "已完成", cancel: "已取消" };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(msg, type) {
    if (window.GB_toast) window.GB_toast(msg, type);
  }

  /* 登录成功后的待办回调（order-form 未登录提交时使用） */
  var pendingCallback = null;

  function getArea() { return document.getElementById("userArea"); }

  function statusText(s) { return STATUS_MAP[s] || s || "未知"; }

  /* ---------------- 模态框基础 ---------------- */
  function openModal(title, body, foot) {
    closeModal();
    var mask = document.createElement("div");
    mask.className = "gb-modal-mask";
    mask.id = "gbModalMask";
    mask.innerHTML =
      '<div class="gb-modal">' +
      '<div class="gb-modal-head"><h3>' + esc(title) + '</h3>' +
      '<button type="button" class="gb-modal-close" id="gbModalClose">×</button></div>' +
      '<div class="gb-modal-body">' + body + "</div>" +
      (foot ? '<div class="gb-modal-foot">' + foot + "</div>" : "") +
      "</div>";
    document.body.appendChild(mask);
    mask.addEventListener("click", function (e) {
      if (e.target === mask) closeModal();
    });
    var close = document.getElementById("gbModalClose");
    if (close) close.addEventListener("click", closeModal);
  }

  function closeModal() {
    var old = document.getElementById("gbModalMask");
    if (old) old.remove();
  }

  /* ---------------- 登录 / 注册 ---------------- */
  function openLogin() {
    openModal("登录",
      '<form id="gbLoginForm" novalidate>' +
      '<div class="field"><label>用户名</label>' +
      '<input type="text" id="gbLgUser" placeholder="用户名（2-20 字符）" autocomplete="username" maxlength="20"></div>' +
      '<div class="field"><label>密码</label>' +
      '<input type="password" id="gbLgPass" placeholder="密码" autocomplete="current-password"></div>' +
      '<div class="gb-alert err" id="gbLgErr" style="display:none"></div>' +
      '<button class="btn btn-primary btn-block" type="submit">登 录</button>' +
      '<p class="gb-modal-tip">还没有账号？<a href="javascript:void 0" id="gbToReg">去注册</a></p>' +
      "</form>");

    var form = document.getElementById("gbLoginForm");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var u = document.getElementById("gbLgUser").value.trim();
      var p = document.getElementById("gbLgPass").value;
      var errBox = document.getElementById("gbLgErr");
      if (!u || !p) {
        errBox.style.display = "block";
        errBox.textContent = "请填写用户名和密码。";
        return;
      }
      errBox.style.display = "none";
      A.login(u, p).then(function (data) {
        if (!data.token || !data.user) throw new Error("登录响应缺少 token/user");
        A.setToken(data.token);
        A.setUser(data.user);
        closeModal();
        renderUserArea();
        toast("登录成功，欢迎回来，@" + data.user.username, "ok");
        var cb = pendingCallback;
        pendingCallback = null;
        if (typeof cb === "function") cb();
      }).catch(function (err) {
        errBox.style.display = "block";
        errBox.textContent = err.message || "登录失败，请重试。";
      });
    });
    var toReg = document.getElementById("gbToReg");
    if (toReg) toReg.addEventListener("click", openRegister);
  }

  function openRegister() {
    openModal("注册",
      '<form id="gbRegForm" novalidate>' +
      '<div class="field"><label>用户名</label>' +
      '<input type="text" id="gbRegUser" placeholder="用户名（2-20 字符）" autocomplete="username" maxlength="20"></div>' +
      '<div class="field"><label>密码</label>' +
      '<input type="password" id="gbRegPass" placeholder="密码（至少 6 位）" autocomplete="new-password"></div>' +
      '<div class="field"><label>邀请码（可选）</label>' +
      '<input type="text" id="gbRegInvite" placeholder="管理员邀请码（可留空）" autocomplete="off"></div>' +
      '<div class="gb-alert err" id="gbRegErr" style="display:none"></div>' +
      '<button class="btn btn-primary btn-block" type="submit">注册并登录</button>' +
      '<p class="gb-modal-tip">已有账号？<a href="javascript:void 0" id="gbToLogin">去登录</a></p>' +
      "</form>");

    var form = document.getElementById("gbRegForm");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var u = document.getElementById("gbRegUser").value.trim();
      var p = document.getElementById("gbRegPass").value;
      var inv = document.getElementById("gbRegInvite").value.trim();
      var errBox = document.getElementById("gbRegErr");
      if (!u || !p) {
        errBox.style.display = "block";
        errBox.textContent = "请填写用户名和密码。";
        return;
      }
      errBox.style.display = "none";
      A.register(u, p, inv).then(function (data) {
        if (!data.token || !data.user) throw new Error("注册响应缺少 token/user");
        A.setToken(data.token);
        A.setUser(data.user);
        closeModal();
        renderUserArea();
        toast("注册成功，欢迎加入，@" + data.user.username, "ok");
        var cb = pendingCallback;
        pendingCallback = null;
        if (typeof cb === "function") cb();
      }).catch(function (err) {
        errBox.style.display = "block";
        errBox.textContent = err.message || "注册失败，请重试。";
      });
    });
    var toLogin = document.getElementById("gbToLogin");
    if (toLogin) toLogin.addEventListener("click", openLogin);
  }

  /* ---------------- 我的订单 ---------------- */
  function openOrders() {
    openModal("我的订单",
      '<div class="gb-alert err" id="gbOdErr" style="display:none"></div>' +
      '<div class="gb-order-list" id="gbOdList"><div class="gb-empty">正在加载…</div></div>',
      '<button class="btn btn-ghost btn-sm" type="button" id="gbOdClose">关闭</button>');

    var closeBtn = document.getElementById("gbOdClose");
    if (closeBtn) closeBtn.addEventListener("click", closeModal);

    var list = document.getElementById("gbOdList");
    var errBox = document.getElementById("gbOdErr");
    A.myOrders().then(function (data) {
      var rows = data.rows || data.list || data.orders || (Array.isArray(data) ? data : []);
      if (!rows.length) {
        list.innerHTML = '<div class="gb-empty">暂无订单，去「联系下单」页提交一单吧。</div>';
        return;
      }
      list.innerHTML = rows.map(function (o) {
        var time = o.created_at ? esc(String(o.created_at)) : "—";
        var price = "¥" + (Number(o.price) || 0);
        return '<div class="gb-order-item">' +
          '<div class="goi-top"><span class="goi-item">' + esc(o.item || "未命名服务") + '</span>' +
          '<span class="gb-status ' + esc(o.status || "") + '">' + esc(statusText(o.status)) + "</span></div>" +
          '<div class="goi-meta">单号：<b>' + esc(o.id || "—") + "</b>　金额：" + price +
          "<br>提交时间：" + time + "</div>" +
          (o.note ? '<div class="goi-meta" style="margin-top:5px">备注：' + esc(o.note) + "</div>" : "") +
          "</div>";
      }).join("");
    }).catch(function (err) {
      list.innerHTML = "";
      errBox.style.display = "block";
      errBox.textContent = err.message || "订单加载失败。";
    });
  }

  /* ---------------- 个人中心 ---------------- */
  function openProfile() {
    var user = A.getUser() || {};
    var roleName = user.role === "admin" ? "管理员" : "普通用户";
    var idText = (user.id != null && user.id !== "") ? esc(String(user.id)) : "—";
    var nameText = user.username ? esc(user.username) : "—";
    var avatarChar = nameText === "—" ? "顾" : esc(String(user.username).charAt(0).toUpperCase());
    openModal("个人中心",
      '<div class="gb-profile">' +
      '<div class="gb-profile-head">' +
      '<span class="gb-profile-avatar">' + avatarChar + "</span>" +
      '<div><b class="gb-profile-name">' + nameText + "</b>" +
      '<span class="gb-profile-role">' + esc(roleName) + "</span></div>" +
      "</div>" +
      '<div class="gb-profile-item"><span class="gp-label">用户 ID</span><span class="gp-val">' + idText + "</span></div>" +
      '<div class="gb-profile-item"><span class="gp-label">账号</span><span class="gp-val">' + nameText + "</span></div>" +
      '<div class="gb-profile-item"><span class="gp-label">角色</span><span class="gp-val">' + esc(roleName) + "</span></div>" +
      '<div class="gb-profile-item"><span class="gp-label">绑定手机</span><span class="gp-val gp-empty">未绑定</span></div>' +
      '<div class="gb-profile-item"><span class="gp-label">绑定微信</span><span class="gp-val gp-empty">未绑定</span></div>' +
      '<p class="gb-bind-hint">注：当前账号体系仅含用户 ID / 账号 / 角色字段，未开放手机、微信等绑定信息，以上两项如实展示为“未绑定”。</p>' +
      "</div>",
      '<button class="btn btn-ghost btn-sm" type="button" id="gbPfOrders">我的订单</button>' +
      '<button class="btn btn-primary btn-sm" type="button" id="gbPfLogout">退出登录</button>');

    var pfOrders = document.getElementById("gbPfOrders");
    if (pfOrders) pfOrders.addEventListener("click", openOrders);
    var pfLogout = document.getElementById("gbPfLogout");
    if (pfLogout) pfLogout.addEventListener("click", function () {
      closeModal();
      A.logout();
      renderUserArea();
      toast("已退出登录", "ok");
    });
  }

  /* ---------------- 用户区渲染 ---------------- */
  function renderUserArea() {
    var area = getArea();
    if (!area) return;
    if (!A.isLoggedIn()) {
      area.innerHTML =
        '<span class="gb-auth-group">' +
        '<button class="gb-auth-link" type="button" data-ua="login">登录</button>' +
        '<button class="gb-auth-cta" type="button" data-ua="register">注册</button>' +
        "</span>";
      return;
    }
    var user = A.getUser() || {};
    var name = user.username || "用户";
    area.innerHTML =
      '<span class="gb-user-ico">👤</span>' +
      '<button class="gb-user-chip" type="button" data-ua="profile" title="打开个人中心">' + esc(name) + "</button>" +
      '<button class="btn btn-ghost btn-sm" type="button" data-ua="orders">我的订单</button>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-ua="logout">退出</button>';
  }

  function initArea() {
    var area = getArea();
    if (!area) return;
    area.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest("[data-ua]") : null;
      if (!btn) return;
      var act = btn.getAttribute("data-ua");
      if (act === "login") openLogin();
      else if (act === "register") openRegister();
      else if (act === "profile") openProfile();
      else if (act === "orders") openOrders();
      else if (act === "logout") {
        A.logout();
        renderUserArea();
        toast("已退出登录", "ok");
      }
    });
  }

  /* ---------------- 对外接口 ---------------- */
  window.GB_Auth = {
    render: renderUserArea,
    isLoggedIn: function () { return A.isLoggedIn(); },
    openLogin: openLogin,
    openRegister: openRegister,
    openOrders: openOrders,
    openProfile: openProfile,
    /* 需要先登录后继续（如提交订单）：弹登录框，登录成功后执行 cb */
    requireLogin: function (cb) {
      pendingCallback = cb;
      openLogin();
    },
    statusText: statusText
  };

  document.addEventListener("DOMContentLoaded", function () {
    initArea();
    renderUserArea();

    /* 顶部置顶悬浮条（注册入口）：点击复用注册弹窗逻辑，与导航栏注册按钮行为一致 */
    var floatReg = document.getElementById("gbFloatReg");
    if (floatReg) floatReg.addEventListener("click", function (e) {
      e.preventDefault();
      openRegister();
    });
  });
})();
