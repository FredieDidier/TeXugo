// electron-builder hook, after the app is assembled and before it is
// signed.
//
// Fuses are switches compiled into the Electron binary. Off: running the
// app as plain Node (ELECTRON_RUN_AS_NODE), the --inspect flags and the
// NODE_OPTIONS variable, so the app cannot be used to run other code.
// They are set here, not under `electronFuses` in electron-builder.yml,
// because on the Mac the app is then signed here too, ad hoc (Apple Silicon
// runs nothing unsigned), after clearing the extended attributes that
// codesign refuses. electron-builder's own signing (identity: null) is off:
// it signs each helper with entitlements and stumbles on those attributes.
const { execFileSync } = require('node:child_process');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  await context.packager.addElectronFuses(context, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
  });
  if (context.electronPlatformName !== 'darwin') return;
  const app = require('node:path').join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('xattr', ['-cr', app]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
