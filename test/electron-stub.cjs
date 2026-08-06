/**
 * Minimal `electron` stand-in so main-process modules can be unit tested in
 * plain Node. Only the surface the modules under test actually touch.
 */
module.exports = {
  app: {
    isPackaged: false,
    getPath: (key) => (key === 'home' ? process.env.TEST_HOME || '/tmp' : '/tmp'),
    getAppPath: () => process.env.TEST_APP_PATH || '/app',
  },
  shell: { showItemInFolder() {} },
  Notification: class {
    on() {}
    show() {}
  },
}
