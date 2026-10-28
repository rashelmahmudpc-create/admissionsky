/* Notification Command Center, route shim for the Admin app shell.
 *
 * The v2 Command Center is a self-contained page (notification-command-center.html)
 * with its own sidebar, top bar, mobile tabs and 4 themes. It must NOT be injected
 * into #app: the previous integration replaced the app shell (nav + themes) and
 * broke navigation. Instead we hand off to a dedicated full-screen document so the
 * two shells can never collide.
 *
 * It still answers to the app's route contract (window.renderNotificationAdmin)
 * so existing deep links (#notif-admin) keep working.
 */
(function () {
  'use strict';

  var PAGE = './notification-command-center.html';

  function openCenter() {
    // Full-document navigation: the Command Center owns the whole viewport.
    // Same-origin, so the admin token in sessionStorage is shared with the Worker.
    window.location.assign(PAGE);
    return '';
  }

  window.NotificationCenterRoute = { render: openCenter, page: PAGE };

  // Back-compat with the contract the app router has always used.
  window.renderNotificationAdmin = openCenter;
})();
