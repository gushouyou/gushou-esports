/* =========================================================
   顾手游电竞 管理后台 - 云端对接逻辑
   ---------------------------------------------------------
   登录：POST /api/login（校验 user.role === 'admin'）
   订单：GET /api/orders/admin、POST /api/orders/:id（状态流转）
   留言：GET /api/messages、DELETE /api/messages/:id
   数据看板：基于云端订单统计
   云端请求失败时明确提示「后端连接失败」，并回落到本机
   localStorage（gb_orders）作为兜底展示。
   ========================================================= */
(function () {
  "use strict";

  var API = window.GB_API;

  /* ---------------- 常量 ---------------- */
  var K_ORDERS = "gb_orders";
  var K_SERVICES = "gb_services";
  var K_SETTINGS = "gb_settings";
  var K_AUTH = "gb_admin_auth"; /* 兼容旧标记：保留 */
  var ADMIN_USER_DEFAULT = "guadmin";

  /* 后台中文状态映射（云端仅三态） */
  var STATUS_MAP = { pending: "进行中", done: "已完成", cancel: "已取消" };
  var STATUS_LIST = ["pending", "done", "cancel"];

  var GAMES = ["英雄联盟", "王者荣耀", "无畏契约", "永劫无间", "其他游戏"];
  var SERVICES_LIST = ["段位代练", "排位上分", "定级赛", "双排陪玩", "账号托管", "活动代肝"];

  var DEFAULT_SERVICES = [
    { name: "段位代练", price: 68, unit: "小段", orders: 3120, online: true },
    { name: "排位上分", price: 12, unit: "星", orders: 8460, online: true },
    { name: "定级赛", price: 158, unit: "十局", orders: 1240, online: true },
    { name: "双排陪玩", price: 45, unit: "小时", orders: 2680, online: true },
    { name: "账号托管", price: 30, unit: "天", orders: 960, online: true },
    { name: "活动代肝", price: 25, unit: "阶段", orders: 1520, online: false }
  ];

  var RANKERS = [
    { id: "GS-1188", game: "王者荣耀", count: 862, rate: "99.2%" },
    { id: "GS-2071", game: "英雄联盟", count: 741, rate: "98.6%" },
    { id: "GS-3345", game: "无畏契约", count: 628, rate: "98.9%" },
    { id: "GS-0092", game: "永劫无间", count: 517, rate: "99.5%" },
    { id: "GS-4410", game: "英雄联盟", count: 402, rate: "97.8%" }
  ];

  /* ---------------- 工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function fmtDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function read(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { toast("本地存储写入失败", "err"); return false; }
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function money(n) { return "¥" + Number(n || 0).toLocaleString("zh-CN"); }

  function toast(msg, type) {
    var wrap = $(".toast-wrap");
    if (!wrap) return;
    var el = document.createElement("div");
    el.className = "toast" + (type === "ok" ? " ok" : type === "err" ? " err" : "");
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0";
      el.style.transform = "translateX(18px)";
      setTimeout(function () { el.remove(); }, 320);
    }, 2400);
  }

  /* ---------------- 云端订单缓存（含来源标记） ---------------- */
  var cloudOrders = [];      /* 云端订单 */
  var ordersSource = "cloud"; /* cloud | local | none */

  /* 归一化云端订单为统一展示结构 */
  function normalizeCloud(o) {
    return {
      id: o.id || "—",
      username: o.username || "—",
      item: o.item || "—",
      price: Number(o.price) || 0,
      status: o.status || "pending",
      note: o.note || "",
      createdAt: o.created_at || ""
    };
  }

  /* 本地兜底：把旧 gb_orders 转成云端字段结构（仅供云端失败时展示） */
  function localFallbackOrders() {
    var list = read(K_ORDERS, []) || [];
    return list.map(function (o) {
      return {
        id: o.id || "—",
        username: o.name || o.contact || "—",
        item: (o.game || "") + " · " + (o.service || "") +
          (o.from || o.to ? "（" + (o.from || "—") + " → " + (o.to || "—") + "）" : ""),
        price: Number(o.amount) || 0,
        status: o.status === "已完成" ? "done" : o.status === "已取消" ? "cancel" :
          (o.status === "进行中" ? "pending" : "pending"),
        note: o.note || "",
        createdAt: o.createdAt || ""
      };
    });
  }

  function getOrders() {
    if (ordersSource === "cloud") return cloudOrders;
    return localFallbackOrders();
  }

  /* 云端加载订单：失败时提示并回落本地 */
  function loadCloudOrders() {
    if (!API) {
      ordersSource = "none";
      toast("后端连接失败：登录组件未加载，请刷新页面重试", "err");
      return Promise.resolve();
    }
    return API.adminOrders().then(function (res) {
      cloudOrders = (res && Array.isArray(res.list) ? res.list : []).map(normalizeCloud);
      ordersSource = "cloud";
      return cloudOrders;
    }).catch(function (err) {
      ordersSource = (read(K_ORDERS, []) || []).length ? "local" : "none";
      toast("后端连接失败：" + (err.message || "无法获取云端订单") + "。已回落到本机兜底数据（如有）。", "err");
      return getOrders();
    });
  }

  /* 设置订单状态 */
  function setOrderStatus(id, status) {
    if (!API) return Promise.reject(new Error("登录组件未加载"));
    return API.updateOrderStatus(id, status).then(function () {
      toast("订单 " + id + " 已设为「" + (STATUS_MAP[status] || status) + "」", "ok");
      return loadCloudOrders().then(renderAll);
    }).catch(function (err) {
      toast("操作失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  /* ---------------- 登录 ---------------- */
  function initLogin() {
    var gate = $("#loginGate");
    var shell = $("#adminShell");
    var form = $("#loginForm");
    var errBox = $("#loginError");
    var userText = $("#adminUserText");

    var cfg = window.GB_ADMIN_AUTH || {};
    var ADMIN_NAME = String(cfg.displayName || "") || "管理员";
    if (userText) { userText.textContent = ADMIN_NAME; }

    function fail(msg) {
      errBox.textContent = msg;
      errBox.classList.add("show");
    }

    function enter() {
      gate.style.display = "none";
      shell.classList.add("show");
      start();
    }

    /* 后台会话：登录返回的 token 存 sessionStorage，并注入 api-client 的 token 来源 */
    function injectToken() {
      if (window.GB_API) {
        window.GB_API.setTokenGetter(function () {
          return sessionStorage.getItem("gb_admin_token") || "";
        });
      }
    }

    /* 会话检查：sessionStorage 中的管理员 token 存在则直接进入 */
    injectToken();
    if (sessionStorage.getItem(K_AUTH) === "1") { enter(); return; }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var u = $("#lg-user").value.trim();
      var p = $("#lg-pass").value;
      if (!u || !p) { fail("请输入账号与密码。"); return; }
      if (!API) { fail("登录组件未加载，请刷新页面后重试。"); return; }

      fail("正在连接云端校验…");
      errBox.classList.add("show");

      API.login(u, p).then(function (res) {
        if (res.user && res.user.role === "admin") {
          var tok = res.token || "";
          sessionStorage.setItem("gb_admin_token", tok);
          sessionStorage.setItem(K_AUTH, "1");
          injectToken();
          errBox.classList.remove("show");
          enter();
          toast("登录成功，欢迎回来", "ok");
        } else {
          fail("该账号不是管理员，无法进入后台。");
        }
      }).catch(function (err) {
        fail("登录失败：" + (err.message || "后端连接失败，请确认已部署 Worker API（api.gushouyou.top）。"));
      });
    });
  }

  function logout() {
    sessionStorage.removeItem(K_AUTH);
    sessionStorage.removeItem("gb_admin_token");
    location.reload();
  }

  /* ---------------- 启动 ---------------- */
  var state = { search: "", status: "" };

  function start() {
    getServices();
    tickClock();
    setInterval(tickClock, 30000);
    initNavSwitch();
    initActions();
    loadCloudOrders().then(renderAll);
    loadChatroom();
  }

  function tickClock() {
    var el = $("#nowText");
    if (el) el.textContent = fmtDate(new Date());
  }

  /* ---------------- 侧栏切换 ---------------- */
  function initNavSwitch() {
    $$(".admin-side a").forEach(function (a) {
      a.addEventListener("click", function () {
        var key = a.getAttribute("data-page");
        $$(".admin-side a").forEach(function (x) { x.classList.toggle("active", x === a); });
        $$(".admin-page").forEach(function (p) {
          p.classList.toggle("active", p.getAttribute("data-page") === key);
        });
      });
    });
  }

  /* ---------------- 渲染入口 ---------------- */
  function renderAll() {
    renderDashboard();
    renderOrders();
    renderServices();
    renderMessages();
  }

  /* ---------------- 看板（基于云端订单统计） ---------------- */
  function renderDashboard() {
    var orders = getOrders();
    var today = todayStr();
    var todayCount = orders.filter(function (o) {
      return (o.createdAt || "").indexOf(today) === 0;
    }).length;
    var doing = orders.filter(function (o) { return o.status === "pending"; }).length;
    var pending = orders.filter(function (o) { return o.status === "pending"; }).length;
    var amount = orders.reduce(function (s, o) {
      return o.status === "cancel" ? s : s + Number(o.price || 0);
    }, 0);

    $("#kpiToday").textContent = todayCount;
    $("#kpiTotal").textContent = orders.length;
    $("#kpiAmount").textContent = money(amount);
    $("#kpiDoing").textContent = doing;
    $("#kpiDoingSub").textContent = "待处理 " + pending + " 单";

    renderTrend(orders);
    renderShare(orders);
    renderRankers();
  }

  function renderTrend(orders) {
    var box = $("#trendBars");
    if (!box) return;
    var days = [];
    var now = new Date();
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now.getTime() - i * 86400000);
      days.push({
        label: pad(d.getMonth() + 1) + "/" + pad(d.getDate()),
        key: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()),
        count: 0
      });
    }
    orders.forEach(function (o) {
      var day = (o.createdAt || "").slice(0, 10);
      days.forEach(function (d) { if (d.key === day) d.count++; });
    });
    /* 云端真实数据，无订单的日子显示 0，不补演示基数 */
    var max = Math.max.apply(null, days.map(function (d) { return d.count; })) || 1;

    box.innerHTML = days.map(function (d) {
      var h = Math.max(4, Math.round((d.count / max) * 150));
      return '<div class="bar-col"><b>' + d.count + '</b>' +
        '<div class="bar" style="height:' + h + 'px"></div>' +
        '<span>' + d.label + '</span></div>';
    }).join("");
  }

  function renderShare(orders) {
    var box = $("#serviceShare");
    if (!box) return;
    var map = {};
    var total = orders.length || 1;
    orders.forEach(function (o) {
      var key = (o.item || "—").split("（")[0] || "—";
      map[key] = (map[key] || 0) + 1;
    });
    var keys = Object.keys(map);
    if (!keys.length) {
      box.innerHTML = '<div class="empty"><div class="empty-icon">📊</div><div>暂无云端订单数据</div></div>';
      return;
    }
    keys.sort(function (a, b) { return map[b] - map[a]; });
    box.innerHTML = keys.map(function (k) {
      var pct = Math.round((map[k] / total) * 100);
      return '<div style="margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between;font-size:13.4px;margin-bottom:7px">' +
        '<span>' + esc(k) + '</span><span style="color:var(--muted)">' + map[k] + ' 单 · ' + pct + '%</span></div>' +
        '<div class="bar-line"><i style="width:' + pct + '%"></i></div></div>';
    }).join("");
  }

  function renderRankers() {
    var body = $("#rankerBody");
    if (!body) return;
    body.innerHTML = RANKERS.map(function (r) {
      return "<tr><td><b>" + esc(r.id) + "</b></td><td>" + esc(r.game) + "</td><td>" +
        r.count + " 单</td><td><span class='pill pill-ok'>" + r.rate + "</span></td></tr>";
    }).join("");
  }

  /* ---------------- 订单 ---------------- */
  function statusPill(s) {
    var zh = STATUS_MAP[s] || s;
    var cls = s === "done" ? "pill-ok" : s === "pending" ? "pill-warn" : "pill-mute";
    return "<span class='pill " + cls + "'>" + esc(zh) + "</span>";
  }

  function filteredOrders() {
    var orders = getOrders();
    var kw = state.search.trim().toLowerCase();
    return orders.filter(function (o) {
      if (state.status && o.status !== state.status) return false;
      if (!kw) return true;
      return [o.id, o.username, o.item, o.note]
        .join(" ").toLowerCase().indexOf(kw) > -1;
    });
  }

  function renderOrders() {
    var body = $("#orderBody");
    var empty = $("#orderEmpty");
    if (!body) return;
    var list = filteredOrders();

    $("#orderCountText").textContent = "共 " + list.length + " 条";

    if (!list.length) {
      body.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";

    body.innerHTML = list.map(function (o) {
      var ops = STATUS_LIST.filter(function (s) { return s !== o.status; }).map(function (s) {
        return '<button class="btn btn-ghost btn-sm" data-act="status" data-id="' + esc(o.id) +
          '" data-status="' + s + '">设为' + esc(STATUS_MAP[s] || s) + "</button>";
      }).join(" ");
      return "<tr>" +
        "<td><b>" + esc(o.id) + "</b></td>" +
        "<td><b>" + esc(o.username) + "</b></td>" +
        "<td>" + esc(o.item) + "</td>" +
        "<td class='td-price'>" + money(o.price) + "</td>" +
        "<td style='white-space:nowrap'>" + esc(o.createdAt || "—") + "</td>" +
        "<td>" + statusPill(o.status) + "</td>" +
        "<td style='white-space:nowrap'>" + ops + "</td>" +
        "</tr>";
    }).join("");
  }

  /* ---------------- 模态框（只读详情） ---------------- */
  function openModal(order) {
    $("#modalTitle").textContent = "订单详情 · " + order.id;
    $("#modalBody").innerHTML =
      '<div class="form-grid">' +
      '<div class="field"><label>单号</label><input type="text" value="' + esc(order.id) + '" readonly></div>' +
      '<div class="field"><label>客户</label><input type="text" value="' + esc(order.username) + '" readonly></div>' +
      '<div class="field"><label>服务项目</label><input type="text" value="' + esc(order.item) + '" readonly></div>' +
      '<div class="field"><label>金额（元）</label><input type="text" value="' + money(order.price) + '" readonly></div>' +
      '<div class="field"><label>订单状态</label><input type="text" value="' + esc(STATUS_MAP[order.status] || order.status) + '" readonly></div>' +
      '<div class="field"><label>提交时间</label><input type="text" value="' + esc(order.createdAt || "—") + '" readonly></div>' +
      '<div class="field full"><label>需求说明</label><textarea rows="4" readonly>' + esc(order.note || "—") + '</textarea></div>' +
      '</div>';

    $("#modalSave").style.display = "none";
    $("#orderModal").classList.add("show");
  }

  function closeModal() {
    $("#orderModal").classList.remove("show");
  }

  /* ---------------- 服务管理 ---------------- */
  function getServices() {
    var s = read(K_SERVICES, null);
    if (!s || !s.length) { write(K_SERVICES, DEFAULT_SERVICES); return DEFAULT_SERVICES.slice(); }
    return s;
  }
  function setServices(s) { return write(K_SERVICES, s); }

  function renderServices() {
    var body = $("#serviceBody");
    if (!body) return;
    var list = getServices();
    body.innerHTML = list.map(function (s, i) {
      return "<tr>" +
        "<td><b>" + esc(s.name) + "</b></td>" +
        "<td><input type='number' min='0' value='" + Number(s.price) + "' data-svc-price='" + i +
        "' style='width:96px;padding:7px 10px;border-radius:8px;border:1px solid var(--line-strong);background:rgba(0,0,0,.3);color:var(--text)'> 元</td>" +
        "<td>每 " + esc(s.unit) + "</td>" +
        "<td>" + Number(s.orders).toLocaleString("zh-CN") + " 单</td>" +
        "<td><span class='switch'><input type='checkbox' data-svc-on='" + i + "'" +
        (s.online ? " checked" : "") + "><span class='slider'></span></span>" +
        " <span style='font-size:12.6px;color:var(--muted)'>" + (s.online ? "已上架" : "已下架") + "</span></td>" +
        "</tr>";
    }).join("");

    $$("[data-svc-price]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var idx = Number(inp.getAttribute("data-svc-price"));
        var list = getServices();
        list[idx].price = Number(inp.value) || 0;
        setServices(list);
        toast("「" + list[idx].name + "」起步价已改为 " + list[idx].price + " 元", "ok");
      });
    });

    $$("[data-svc-on]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        var idx = Number(cb.getAttribute("data-svc-on"));
        var list = getServices();
        list[idx].online = cb.checked;
        setServices(list);
        renderServices();
        toast("「" + list[idx].name + "」已" + (cb.checked ? "上架" : "下架"), cb.checked ? "ok" : "");
      });
    });
  }

  /* ---------------- 客户留言（云端） ---------------- */
  var cloudMessages = [];
  var messagesSource = "cloud"; /* cloud | none */

  function loadMessages() {
    if (!API) {
      messagesSource = "none";
      renderMessages();
      return Promise.resolve();
    }
    return API.listMessages().then(function (res) {
      cloudMessages = (res && Array.isArray(res.list) ? res.list : []).map(function (m) {
        return { id: m.id, username: m.username, content: m.content, createdAt: m.created_at };
      });
      messagesSource = "cloud";
      renderMessages();
    }).catch(function (err) {
      messagesSource = "none";
      toast("留言加载失败：" + (err.message || "后端连接失败"), "err");
      renderMessages();
    });
  }

  function renderMessages() {
    var box = $("#messageList");
    var empty = $("#messageEmpty");
    if (!box) return;
    var list = cloudMessages;

    if (messagesSource === "cloud" && !list.length) {
      box.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    if (messagesSource === "none") {
      empty.style.display = "none";
      box.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div>' +
        "<div>后端连接失败，无法获取留言。请确认已部署 Worker API（api.gushouyou.top）。</div></div>";
      return;
    }
    empty.style.display = "none";
    box.innerHTML = list.map(function (m) {
      return '<div class="panel" style="margin-bottom:14px">' +
        '<div class="panel-head" style="margin-bottom:12px">' +
        "<h3>" + esc(m.username) + "</h3>" +
        "<span class='panel-sub'>" + esc(m.createdAt || "—") + "</span></div>" +
        '<p style="color:var(--muted);font-size:14px">' + esc(m.content) + '</p>' +
        '<button class="btn btn-ghost btn-sm" style="margin-top:10px" data-act="delmsg" data-id="' +
        esc(m.id) + '">删除留言</button></div>';
    }).join("");
  }

  function deleteMessage(id) {
    if (!API) { toast("后端连接失败", "err"); return; }
    API.deleteMessage(id).then(function () {
      toast("留言已删除", "ok");
      return loadMessages();
    }).catch(function (err) {
      toast("删除失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  /* ---------------- 聊天室管理（云端 admin API） ---------------- */
  var cloudUsers = [];
  var cloudRooms = [];
  var usersLoaded = false;
  var roomsLoaded = false;

  function loadChatroom() {
    if (!API) { toast("后端连接失败：登录组件未加载", "err"); return Promise.resolve(); }
    return Promise.all([
      API.adminListUsers().then(function (res) {
        cloudUsers = (res && Array.isArray(res.list) ? res.list : []).slice();
        usersLoaded = true;
        renderChatroomUsers();
      }).catch(function (err) {
        usersLoaded = false;
        toast("用户列表加载失败：" + (err.message || "后端连接失败"), "err");
        renderChatroomUsers();
      }),
      API.adminListRooms().then(function (res) {
        cloudRooms = (res && Array.isArray(res.list) ? res.list : []).slice();
        roomsLoaded = true;
        renderChatroomRooms();
      }).catch(function (err) {
        roomsLoaded = false;
        toast("房间列表加载失败：" + (err.message || "后端连接失败"), "err");
        renderChatroomRooms();
      })
    ]);
  }

  function rolePill(r) {
    return r === "admin"
      ? "<span class='pill pill-ok'>管理员</span>"
      : "<span class='pill pill-mute'>用户</span>";
  }
  function passPill(h) {
    return h ? "<span class='pill pill-warn'>已设密</span>" : "<span class='pill pill-mute'>无密码</span>";
  }

  function renderChatroomUsers() {
    var body = $("#chatroomUserBody");
    var empty = $("#chatroomUserEmpty");
    if (!body) return;
    if (!usersLoaded) {
      empty.style.display = "none";
      body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">后端连接失败，无法加载用户列表</td></tr>';
      return;
    }
    if (!cloudUsers.length) {
      body.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    body.innerHTML = cloudUsers.map(function (u) {
      return "<tr>" +
        "<td><b>" + esc(u.id) + "</b></td>" +
        "<td><b>" + esc(u.username) + "</b></td>" +
        "<td>" + esc(u.digital_id || "—") + "</td>" +
        "<td>" + rolePill(u.role) + "</td>" +
        "<td>" + esc(u.created_at || "—") + "</td>" +
        "<td>" + (Number(u.in_voice) ? "<span class='pill pill-ok'>在线</span>" : "<span class='pill pill-mute'>离线</span>") + "</td>" +
        "<td style='white-space:nowrap'>" +
        "<button class='btn btn-ghost btn-sm' data-ua='edit' data-id='" + esc(u.id) + "'>编辑</button> " +
        "<button class='btn btn-ghost btn-sm' data-ua='reset' data-id='" + esc(u.id) + "'>重置密码</button> " +
        (u.role === "admin"
          ? "<button class='btn btn-ghost btn-sm' data-ua='role' data-id='" + esc(u.id) + "' data-role='user'>取消管理员</button>"
          : "<button class='btn btn-ghost btn-sm' data-ua='role' data-id='" + esc(u.id) + "' data-role='admin'>设为管理员</button>") +
        "</td></tr>";
    }).join("");
  }

  function renderChatroomRooms() {
    var body = $("#chatroomRoomBody");
    var empty = $("#chatroomRoomEmpty");
    if (!body) return;
    if (!roomsLoaded) {
      empty.style.display = "none";
      body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted)">后端连接失败，无法加载房间列表</td></tr>';
      return;
    }
    if (!cloudRooms.length) {
      body.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    body.innerHTML = cloudRooms.map(function (r) {
      return "<tr>" +
        "<td><b>" + esc(r.room_no) + "</b></td>" +
        "<td><b>" + esc(r.name) + "</b></td>" +
        "<td>" + esc(r.owner_name || "—") + "</td>" +
        "<td>" + Number(r.member_count || 0) + "</td>" +
        "<td>" + passPill(r.has_pass) + "</td>" +
        "<td>" + Number(r.voice_count || 0) + "</td>" +
        "<td>" + esc(r.created_at || "—") + "</td>" +
        "<td style='white-space:nowrap'>" +
        "<button class='btn btn-ghost btn-sm' data-ra='rename' data-no='" + esc(r.room_no) + "'>改名</button> " +
        "<button class='btn btn-ghost btn-sm' data-ra='pass' data-no='" + esc(r.room_no) + "'>改密</button> " +
        "<button class='btn btn-ghost btn-sm' data-ra='dissolve' data-no='" + esc(r.room_no) + "'>解散</button>" +
        "</td></tr>";
    }).join("");
  }

  function promptTrim(msg, fallback) {
    var v = window.prompt(msg, fallback == null ? "" : fallback);
    if (v === null) return null; /* 用户取消 */
    return String(v).trim();
  }

  function doUserEdit(u) {
    var name = promptTrim("请输入新用户名（留空保持不变）", u.username);
    if (name === null) return;
    var did = promptTrim("请输入新数字 ID（6-9 位，留空保持不变）", u.digital_id || "");
    if (did === null) return;
    var patch = {};
    if (name) patch.username = name;
    if (did) patch.digital_id = did;
    if (!Object.keys(patch).length) { toast("未做任何修改", ""); return; }
    API.adminUpdateUser(u.id, patch).then(function () {
      toast("用户 " + u.username + " 信息已更新", "ok");
      return loadChatroom();
    }).catch(function (err) {
      toast("更新失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  function doUserReset(u) {
    var pwd = window.prompt("请输入 " + u.username + " 的新密码（至少 6 位）", "");
    if (pwd === null) return;
    pwd = String(pwd);
    if (pwd.length < 6) { toast("密码至少 6 位", "err"); return; }
    API.adminUpdateUser(u.id, { password: pwd }).then(function () {
      toast("用户 " + u.username + " 密码已重置", "ok");
    }).catch(function (err) {
      toast("重置失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  function doUserRole(u, role) {
    var zh = role === "admin" ? "设为管理员" : "取消管理员";
    if (!window.confirm("确定将「" + u.username + "」" + zh + "吗？")) return;
    API.adminSetRole(u.id, role).then(function () {
      toast("已" + zh + "「" + u.username + "」", "ok");
      return loadChatroom();
    }).catch(function (err) {
      toast("操作失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  function doRoomRename(r) {
    var name = promptTrim("请输入房间 " + r.room_no + " 的新名称", r.name);
    if (name === null) return;
    if (!name) { toast("房间名不能为空", "err"); return; }
    API.adminUpdateRoom(r.room_no, { name: name }).then(function () {
      toast("房间 " + r.room_no + " 已改名为「" + name + "」", "ok");
      return loadChatroom();
    }).catch(function (err) {
      toast("改名失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  function doRoomPass(r) {
    var pwd = window.prompt("请输入房间 " + r.room_no + " 的新密码（4-20 位；留空表示取消密码）", "");
    if (pwd === null) return;
    pwd = String(pwd).trim();
    if (pwd && (pwd.length < 4 || pwd.length > 20)) { toast("房间密码需 4-20 位", "err"); return; }
    API.adminUpdateRoom(r.room_no, { password: pwd }).then(function () {
      toast(pwd ? "房间 " + r.room_no + " 已设置密码" : "房间 " + r.room_no + " 密码已取消", "ok");
      return loadChatroom();
    }).catch(function (err) {
      toast("设置失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  function doRoomDissolve(r) {
    if (!window.confirm("确定解散房间 " + r.room_no + "（" + r.name + "）吗？解散后成员、消息、语音会话将全部清除，且不可恢复。")) return;
    API.adminDissolveRoom(r.room_no).then(function () {
      toast("房间 " + r.room_no + " 已解散", "ok");
      return loadChatroom();
    }).catch(function (err) {
      toast("解散失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  function doRoomCreate() {
    var name = promptTrim("请输入新房间名称", "");
    if (name === null) return;
    if (!name) { toast("房间名不能为空", "err"); return; }
    var pwd = promptTrim("请输入房间密码（4-20 位，可留空表示无密码）", "");
    if (pwd === null) return;
    if (pwd && (pwd.length < 4 || pwd.length > 20)) { toast("房间密码需 4-20 位", "err"); return; }
    var ownerId = promptTrim("请输入房主用户 ID（可留空默认当前管理员）", "");
    if (ownerId === null) return;
    API.adminCreateRoom(name, pwd, ownerId || undefined).then(function (res) {
      toast("房间「" + name + "」已创建（号 " + (res.room ? res.room.room_no : "") + "）", "ok");
      return loadChatroom();
    }).catch(function (err) {
      toast("创建失败：" + (err.message || "后端连接失败"), "err");
    });
  }

  /* ---------------- 导出 ---------------- */
  function download(filename, text) {
    var blob = new Blob([text], { type: "application/json;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  /* ---------------- 事件绑定 ---------------- */
  function initActions() {
    // 订单表格操作
    $("#orderBody").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-act]");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      var act = btn.getAttribute("data-act");
      if (act === "status") {
        setOrderStatus(id, btn.getAttribute("data-status"));
      }
    });

    // 留言删除
    $("#messageList").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-act='delmsg']");
      if (!btn) return;
      var id = btn.getAttribute("data-id");
      if (window.confirm("确定删除该留言吗？删除后不可恢复。")) deleteMessage(id);
    });

    // 搜索 / 筛选
    var search = $("#orderSearch");
    if (search) {
      search.addEventListener("input", function () {
        state.search = search.value;
        renderOrders();
      });
    }
    var sf = $("#orderStatusFilter");
    if (sf) {
      sf.addEventListener("change", function () {
        state.status = sf.value;
        renderOrders();
      });
    }

    // 导出（云端订单）
    var ex = $("#exportBtn");
    if (ex) {
      ex.addEventListener("click", function () {
        download("gushou-orders.json", JSON.stringify(getOrders(), null, 2));
        toast("订单数据已导出", "ok");
      });
    }
    var sex = $("#settingsExport");
    if (sex) {
      sex.addEventListener("click", function () {
        download("gushou-backup.json", JSON.stringify({
          exportedAt: fmtDate(new Date()),
          orders: getOrders(),
          services: getServices(),
          settings: read(K_SETTINGS, {})
        }, null, 2));
        toast("全部数据已导出", "ok");
      });
    }
    var scl = $("#settingsClearOrders");
    if (scl) {
      scl.addEventListener("click", function () {
        if (window.confirm("确定清空本机兜底订单数据吗？云端订单不受影响。")) {
          write(K_ORDERS, []);
          loadCloudOrders().then(renderAll);
          toast("本机兜底订单已清空", "ok");
        }
      });
    }

    // 服务恢复默认
    var rs = $("#resetServicesBtn");
    if (rs) {
      rs.addEventListener("click", function () {
        setServices(DEFAULT_SERVICES.slice());
        renderServices();
        toast("服务配置已恢复默认", "ok");
      });
    }

    // 设置保存（输入即保存）
    var settingFields = [
      ["#st-name", "name"], ["#st-slogan", "slogan"], ["#st-qq", "qq"],
      ["#st-wechat", "wechat"], ["#st-mail", "mail"], ["#st-phone", "phone"]
    ];
    settingFields.forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.addEventListener("change", function () {
        var s = read(K_SETTINGS, {});
        s[pair[1]] = el.value;
        write(K_SETTINGS, s);
        toast("设置已保存", "ok");
      });
    });

    var swUrgent = $("#sw-urgent"), swAuto = $("#sw-auto"), swMaintain = $("#sw-maintain");
    [[swUrgent, "urgent"], [swAuto, "autoDispatch"], [swMaintain, "maintain"]].forEach(function (p) {
      if (!p[0]) return;
      p[0].addEventListener("change", function () {
        var s = read(K_SETTINGS, {});
        s[p[1]] = p[0].checked;
        write(K_SETTINGS, s);
        toast("「" + (p[1] === "urgent" ? "加急通道" : p[1] === "autoDispatch" ? "自动派单" : "维护模式") +
          "」已" + (p[0].checked ? "开启" : "关闭"), "ok");
      });
    });

    // 模态框
    $("#modalCancel").addEventListener("click", closeModal);
    $("#modalClose").addEventListener("click", closeModal);
    $("#orderModal").addEventListener("click", function (e) {
      if (e.target === $("#orderModal")) closeModal();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });

    // 刷新 / 退出
    $("#refreshBtn").addEventListener("click", function () {
      loadCloudOrders().then(renderAll);
      loadMessages();
      loadChatroom();
      toast("云端数据已刷新", "ok");
    });
    $("#logoutBtn").addEventListener("click", logout);

    // 聊天室管理
    var uBody = $("#chatroomUserBody");
    if (uBody) {
      uBody.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-ua]");
        if (!btn) return;
        var id = Number(btn.getAttribute("data-id"));
        var u = null;
        cloudUsers.forEach(function (x) { if (Number(x.id) === id) u = x; });
        if (!u) return;
        var act = btn.getAttribute("data-ua");
        if (act === "edit") doUserEdit(u);
        else if (act === "reset") doUserReset(u);
        else if (act === "role") doUserRole(u, btn.getAttribute("data-role"));
      });
    }
    var rBody = $("#chatroomRoomBody");
    if (rBody) {
      rBody.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-ra]");
        if (!btn) return;
        var no = Number(btn.getAttribute("data-no"));
        var r = null;
        cloudRooms.forEach(function (x) { if (Number(x.room_no) === no) r = x; });
        if (!r) return;
        var act = btn.getAttribute("data-ra");
        if (act === "rename") doRoomRename(r);
        else if (act === "pass") doRoomPass(r);
        else if (act === "dissolve") doRoomDissolve(r);
      });
    }
    var addRoom = $("#chatroomAddRoom");
    if (addRoom) addRoom.addEventListener("click", doRoomCreate);
  }

  /* ---------------- 入口 ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    initLogin();
    /* 登录成功后 start() 内会加载云端订单与留言 */
  });
})();
