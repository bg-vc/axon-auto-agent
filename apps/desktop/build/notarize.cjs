const { notarize } = require('@electron/notarize')

module.exports = async function notarizeApp(context) {
  if (process.platform !== 'darwin' || !process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) return
  const appName = context.packager.appInfo.productFilename
  await notarize({
    appPath: `${context.appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  })
}
