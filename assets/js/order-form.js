/* =========================================================
   顾手游电竞 - 前台需求表单逻辑（云端对接：POST /api/orders）
   依赖：api-client.js（window.GB_API）、user-auth.js（window.GB_Auth）
   未登录提交时先自动弹出登录框，登录成功后继续提交；
   提交成功后订单进入云端，可在前台「我的订单」查看。
   ========================================================= */
(function () {
  "use strict";

  var API = window.GB_API;
  var AUTH = window.GB_Auth;

  /* 预算区间 → 数值（取区间上限，留空/不限传 0） */
  var BUDGET_PRICE = {
    "200 元以内": 200,
    "200 - 500 元": 500,
    "500 - 1000 元": 1000,
    "1000 元以上": 1500
  };

  function initForm() {
    var form = document.getElementById("orderForm");
    if (!form) return;

    var okBox = document.getElementById("formSuccess");
    var errBox = document.getElementById("formError");

    function showBox(box, msg) {
      okBox.classList.remove("show");
      errBox.classList.remove("show");
      box.textContent = msg;
      box.classList.add("show");
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    function mark(field, bad) {
      var wrap = field.closest(".field");
      if (wrap) wrap.classList.toggle("invalid", bad);
      return bad;
    }

    function readForm() {
      var game = form.querySelector("#f-game").value;
      var service = form.querySelector("#f-service").value;
      var from = (form.querySelector("#f-from").value || "").trim();
      var to = (form.querySelector("#f-to").value || "").trim();
      var contact = (form.querySelector("#f-contact").value || "").trim();
      var deadline = (form.querySelector("#f-deadline").value || "").trim();
      var note = (form.querySelector("#f-note").value || "").trim();
      var amount = form.querySelector("#f-amount");
      var budget = form.querySelector("#f-budget").value;

      /* item = 游戏 · 服务（当前段位 → 目标段位） */
      var item = game + " · " + service;
      if (from || to) item += "（" + (from || "—") + " → " + (to || "—") + "）";

      /* price：优先用户填的数字，其次预算下拉映射，均无则 0 */
      var price = 0;
      var num = amount ? Number(amount.value) : NaN;
      if (!isNaN(num) && num > 0) {
        price = Math.round(num);
      } else if (budget && BUDGET_PRICE[budget]) {
        price = BUDGET_PRICE[budget];
      }

      /* note = 联系方式 + 期望完成时间 + 补充说明 拼接 */
      var noteParts = [];
      if (contact) noteParts.push("联系方式：" + contact);
      if (deadline) noteParts.push("期望完成时间：" + deadline);
      if (note) noteParts.push("补充说明：" + note);
      var noteJoined = noteParts.join("；");

      return { item: item, price: price, note: noteJoined };
    }

    function submitOrder() {
      var data = readForm();
      return API.createOrder(data.item, data.price, data.note).then(function () {
        var tip = "提交成功！需求单已进入云端队列，客服将在 18 分钟内联系你。可在顶部「我的订单」查看处理进度。";
        showBox(okBox, tip);
        if (window.GB_toast) window.GB_toast("需求已提交，可在「我的订单」查看", "ok");
        form.reset();
        document.querySelectorAll("#orderForm .field.invalid").forEach(function (f) {
          f.classList.remove("invalid");
        });
      }).catch(function (err) {
        showBox(errBox, "提交失败：" + (err.message || "请稍后重试或直接联系客服。"));
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var name = form.querySelector("#f-name");
      var contact = form.querySelector("#f-contact");
      var game = form.querySelector("#f-game");
      var service = form.querySelector("#f-service");

      var bad = false;
      bad = mark(name, !name.value.trim()) || bad;
      bad = mark(contact, !contact.value.trim()) || bad;
      bad = mark(game, !game.value) || bad;
      bad = mark(service, !service.value) || bad;

      if (bad) {
        showBox(errBox, "请先补全带 * 的必填项后再提交。");
        return;
      }

      if (!API || !AUTH) {
        showBox(errBox, "登录组件未加载，请刷新页面后重试。");
        return;
      }

      if (AUTH.isLoggedIn()) {
        submitOrder();
      } else {
        showBox(okBox, "请先登录后再提交需求单。");
        AUTH.requireLogin(function () { submitOrder(); });
      }
    });

    form.addEventListener("reset", function () {
      okBox.classList.remove("show");
      errBox.classList.remove("show");
      document.querySelectorAll("#orderForm .field.invalid").forEach(function (f) {
        f.classList.remove("invalid");
      });
    });

    ["#f-name", "#f-contact", "#f-game", "#f-service"].forEach(function (sel) {
      var el = form.querySelector(sel);
      if (!el) return;
      el.addEventListener("input", function () { mark(el, false); });
      el.addEventListener("change", function () { mark(el, false); });
    });
  }

  document.addEventListener("DOMContentLoaded", initForm);
})();
