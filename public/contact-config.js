/* Project contact settings. Change managementEmail here when a dedicated mailbox is ready. */
window.PROJECT_CONTACT = Object.freeze({
  project: "وکیل‌یار",
  managementEmail: "jamish2575@gmail.com"
});
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("[data-management-email]").forEach(function (link) {
    link.href = "mailto:" + window.PROJECT_CONTACT.managementEmail;
    link.textContent = window.PROJECT_CONTACT.managementEmail;
  });
});
