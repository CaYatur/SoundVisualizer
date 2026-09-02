'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

if (process.platform !== 'win32') {
  console.log('Sparse package identity is required only for Windows builds.');
  process.exit(0);
}

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const output = path.join(root, 'build', 'identity');
const manifestDir = path.join(output, 'package');
const packageName = 'CAYADEV.SoundVisualizer.Identity';
const applicationId = 'CAYADEVSoundVisualizer';
const publisher = 'CN=CAYADEV SoundVisualizer';
const fourPartVersion = `${pkg.version}.1`;
const pfx = path.join(output, 'CAYADEV.SoundVisualizer.Identity.pfx');
const cer = path.join(output, 'CAYADEV.SoundVisualizer.Identity.cer');
const passwordFile = path.join(output, '.pfx-password');
const msix = path.join(output, 'CAYADEV.SoundVisualizer.Identity.msix');
const appManifest = path.join(output, 'CAYADEV.Visualizer.exe.manifest');

function findSdkTool(name) {
  const roots = [
    'C:/Program Files (x86)/Windows Kits/10/bin',
    'C:/Program Files/Windows Kits/10/bin',
  ];
  const matches = [];
  for (const sdkRoot of roots) {
    if (!fs.existsSync(sdkRoot)) continue;
    for (const version of fs.readdirSync(sdkRoot)) {
      const candidate = path.join(sdkRoot, version, 'x64', name);
      if (fs.existsSync(candidate)) matches.push({ version, candidate });
    }
  }
  matches.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  if (!matches.length) throw new Error(`${name} was not found in the Windows SDK.`);
  return matches[0].candidate;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(executable)} failed with exit code ${result.status}.`);
}

fs.rmSync(manifestDir, { recursive: true, force: true });
fs.mkdirSync(manifestDir, { recursive: true });
const pkgResources = path.join(manifestDir, 'resources', 'identity');
fs.mkdirSync(pkgResources, { recursive: true });

const iconSource = path.join(root, 'assets', 'icon.svg');
const packageIconBackground = { r: 0, g: 0, b: 0, alpha: 0 };
const iconJobs = [
  ['icon.png', 256],
  ['Square44x44Logo.scale-100.png', 44],
  ['Square44x44Logo.scale-125.png', 55],
  ['Square44x44Logo.scale-150.png', 66],
  ['Square44x44Logo.scale-200.png', 88],
  ['Square44x44Logo.scale-400.png', 176],
  ['Square44x44Logo.targetsize-16.png', 16],
  ['Square44x44Logo.targetsize-20.png', 20],
  ['Square44x44Logo.targetsize-24.png', 24],
  ['Square44x44Logo.targetsize-30.png', 30],
  ['Square44x44Logo.targetsize-32.png', 32],
  ['Square44x44Logo.targetsize-36.png', 36],
  ['Square44x44Logo.targetsize-40.png', 40],
  ['Square44x44Logo.targetsize-44.png', 44],
  ['Square44x44Logo.targetsize-48.png', 48],
  ['Square44x44Logo.targetsize-64.png', 64],
  ['Square44x44Logo.targetsize-72.png', 72],
  ['Square44x44Logo.targetsize-80.png', 80],
  ['Square44x44Logo.targetsize-96.png', 96],
  ['Square44x44Logo.targetsize-256.png', 256],
  ['Square44x44Logo.targetsize-16_altform-unplated.png', 16],
  ['Square44x44Logo.targetsize-20_altform-unplated.png', 20],
  ['Square44x44Logo.targetsize-24_altform-unplated.png', 24],
  ['Square44x44Logo.targetsize-30_altform-unplated.png', 30],
  ['Square44x44Logo.targetsize-32_altform-unplated.png', 32],
  ['Square44x44Logo.targetsize-36_altform-unplated.png', 36],
  ['Square44x44Logo.targetsize-40_altform-unplated.png', 40],
  ['Square44x44Logo.targetsize-44_altform-unplated.png', 44],
  ['Square44x44Logo.targetsize-48_altform-unplated.png', 48],
  ['Square44x44Logo.targetsize-64_altform-unplated.png', 64],
  ['Square44x44Logo.targetsize-72_altform-unplated.png', 72],
  ['Square44x44Logo.targetsize-80_altform-unplated.png', 80],
  ['Square44x44Logo.targetsize-96_altform-unplated.png', 96],
  ['Square44x44Logo.targetsize-256_altform-unplated.png', 256],
  ['Square44x44Logo.targetsize-16_altform-lightunplated.png', 16],
  ['Square44x44Logo.targetsize-20_altform-lightunplated.png', 20],
  ['Square44x44Logo.targetsize-24_altform-lightunplated.png', 24],
  ['Square44x44Logo.targetsize-30_altform-lightunplated.png', 30],
  ['Square44x44Logo.targetsize-32_altform-lightunplated.png', 32],
  ['Square44x44Logo.targetsize-36_altform-lightunplated.png', 36],
  ['Square44x44Logo.targetsize-40_altform-lightunplated.png', 40],
  ['Square44x44Logo.targetsize-44_altform-lightunplated.png', 44],
  ['Square44x44Logo.targetsize-48_altform-lightunplated.png', 48],
  ['Square44x44Logo.targetsize-64_altform-lightunplated.png', 64],
  ['Square44x44Logo.targetsize-72_altform-lightunplated.png', 72],
  ['Square44x44Logo.targetsize-80_altform-lightunplated.png', 80],
  ['Square44x44Logo.targetsize-96_altform-lightunplated.png', 96],
  ['Square44x44Logo.targetsize-256_altform-lightunplated.png', 256],
  ['Square150x150Logo.scale-100.png', 150],
  ['Square150x150Logo.scale-125.png', 188],
  ['Square150x150Logo.scale-150.png', 225],
  ['Square150x150Logo.scale-200.png', 300],
  ['Square150x150Logo.scale-400.png', 600],
];
const iconScript = `
  const sharp = require('sharp');
  const path = require('path');
  const [source, outputDir1, outputDir2, jobsJson, backgroundJson] = process.argv.slice(1);
  const jobs = JSON.parse(jobsJson);
  const background = JSON.parse(backgroundJson);
  const outDirs = [outputDir1, outputDir2].filter(Boolean);
  Promise.all(jobs.flatMap(([name, size]) =>
    outDirs.map((dir) =>
      sharp(source, { density: 384 })
        .resize(size, size, { fit: 'contain', background })
        .png()
        .toFile(path.join(dir, name))
    )
  )).catch((error) => { console.error(error); process.exit(1); });
`;
run(process.execPath, ['-e', iconScript, iconSource, output, pkgResources, JSON.stringify(iconJobs), JSON.stringify(packageIconBackground)]);

let password;
if (fs.existsSync(pfx) && fs.existsSync(cer) && fs.existsSync(passwordFile)) {
  password = fs.readFileSync(passwordFile, 'utf8').trim();
} else {
  password = crypto.randomBytes(24).toString('base64url');
  fs.mkdirSync(output, { recursive: true });
  const ps = [
    `$pwd = ConvertTo-SecureString '${password}' -AsPlainText -Force`,
    `$cert = New-SelfSignedCertificate -Type Custom -Subject '${publisher}' -KeyUsage DigitalSignature -FriendlyName 'CAYADEV SoundVisualizer Identity' -CertStoreLocation 'Cert:\\CurrentUser\\My' -HashAlgorithm SHA256 -KeyLength 2048 -NotAfter (Get-Date).AddYears(5)`,
    `Export-PfxCertificate -Cert $cert -FilePath '${pfx.replace(/'/g, "''")}' -Password $pwd | Out-Null`,
    `Export-Certificate -Cert $cert -FilePath '${cer.replace(/'/g, "''")}' | Out-Null`,
    `Remove-Item -Path ('Cert:\\CurrentUser\\My\\' + $cert.Thumbprint) -Force`,
  ].join('; ');
  run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
  fs.writeFileSync(passwordFile, password, { mode: 0o600 });
}

const appxManifest = `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap3="http://schemas.microsoft.com/appx/manifest/uap/windows10/3"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap3 uap10 rescap">
  <Identity Name="${packageName}" Publisher="${publisher}" Version="${fourPartVersion}" ProcessorArchitecture="neutral" />
  <Properties>
    <DisplayName>CAYADEV Visualizer</DisplayName>
    <PublisherDisplayName>CAYADEV</PublisherDisplayName>
    <Logo>resources\\identity\\Square150x150Logo.png</Logo>
    <uap10:AllowExternalContent>true</uap10:AllowExternalContent>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
    <rescap:Capability Name="unvirtualizedResources" />
  </Capabilities>
  <Applications>
    <Application Id="${applicationId}" Executable="CAYADEV Visualizer.exe" uap10:TrustLevel="mediumIL" uap10:RuntimeBehavior="win32App">
      <uap:VisualElements AppListEntry="none" DisplayName="CAYADEV Visualizer" Description="Audio-reactive visualizer and Dynamic Lighting controller" BackgroundColor="transparent" Square150x150Logo="resources\\identity\\Square150x150Logo.png" Square44x44Logo="resources\\identity\\Square44x44Logo.png" />
      <Extensions>
        <uap3:Extension Category="windows.appExtension">
          <uap3:AppExtension Name="com.microsoft.windows.lighting" Id="DynamicLighting" PublicFolder="public" DisplayName="CAYADEV Visualizer" />
        </uap3:Extension>
      </Extensions>
    </Application>
  </Applications>
</Package>
`;
fs.writeFileSync(path.join(manifestDir, 'AppxManifest.xml'), appxManifest);

const sideBySideManifest = `<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <assemblyIdentity version="${fourPartVersion}" name="CAYADEV.SoundVisualizer" />
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false" /></requestedPrivileges></security>
  </trustInfo>
  <msix xmlns="urn:schemas-microsoft-com:msix.v1" publisher="${publisher}" packageName="${packageName}" applicationId="${applicationId}" />
</assembly>
`;
fs.writeFileSync(appManifest, sideBySideManifest);

const installScript = `param(
  [Parameter(Mandatory = $true)][string]$ExternalLocation,
  [ValidateSet('CurrentUser','LocalMachine')][string]$CertificateStore = 'CurrentUser',
  [string]$RestartExecutable = '',
  [int]$WaitForProcessId = 0,
  [string]$RestartLog = ''
)
$ErrorActionPreference = 'Stop'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$cer = Join-Path $base 'CAYADEV.SoundVisualizer.Identity.cer'
$msix = Join-Path $base 'CAYADEV.SoundVisualizer.Identity.msix'
if ($CertificateStore -eq 'CurrentUser') {
  & certutil.exe -user -addstore -f TrustedPeople $cer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to trust the Dynamic Lighting certificate in CurrentUser TrustedPeople.' }
  & certutil.exe -user -addstore -f Root $cer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to trust the Dynamic Lighting certificate in CurrentUser Root.' }
} else {
  & certutil.exe -addstore -f TrustedPeople $cer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to trust the Dynamic Lighting certificate in LocalMachine TrustedPeople.' }
  & certutil.exe -addstore -f Root $cer | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to trust the Dynamic Lighting certificate in LocalMachine Root.' }
}
if ($RestartLog) {
  "[$(Get-Date -Format o)] Identity installation started. ExternalLocation=$ExternalLocation RestartExecutable=$RestartExecutable WaitForProcessId=$WaitForProcessId" | Set-Content -LiteralPath $RestartLog -Encoding UTF8
}
Get-AppxPackage -Name '${packageName}' -ErrorAction SilentlyContinue | Remove-AppxPackage -ErrorAction SilentlyContinue
Add-AppxPackage -Path $msix -ExternalLocation $ExternalLocation -ForceApplicationShutdown
if ($RestartExecutable -and (Test-Path -LiteralPath $RestartExecutable)) {
  if ($WaitForProcessId -gt 0) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
      if (-not (Get-Process -Id $WaitForProcessId -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 500
    }
  }
  Start-Sleep -Seconds 2
  if ($RestartLog) {
    "[$(Get-Date -Format o)] Restarting portable executable through Explorer: $RestartExecutable" | Add-Content -LiteralPath $RestartLog -Encoding UTF8
  }
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $RestartExecutable + '"')
} elseif ($RestartLog) {
  "[$(Get-Date -Format o)] Portable restart target was empty or missing." | Add-Content -LiteralPath $RestartLog -Encoding UTF8
}
`;
fs.writeFileSync(path.join(output, 'install-identity.ps1'), installScript);

const uninstallScript = `$ErrorActionPreference = 'SilentlyContinue'
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$cer = Join-Path $base 'CAYADEV.SoundVisualizer.Identity.cer'
$certificate = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($cer)
$thumbprint = $certificate.Thumbprint
Get-AppxPackage -Name '${packageName}' | Remove-AppxPackage
foreach ($store in @(
  'Cert:\\CurrentUser\\TrustedPeople',
  'Cert:\\CurrentUser\\Root',
  'Cert:\\LocalMachine\\TrustedPeople',
  'Cert:\\LocalMachine\\Root'
)) {
  Remove-Item -Path (Join-Path $store $thumbprint) -Force -ErrorAction SilentlyContinue
}
`;
fs.writeFileSync(path.join(output, 'uninstall-identity.ps1'), uninstallScript);

const makePri = findSdkTool('makepri.exe');
const priConfig = path.join(output, 'priconfig.xml');
run(makePri, ['createconfig', '/cf', priConfig, '/dq', 'lang-en-US', '/pv', '10.0.0', '/o']);
run(makePri, ['new', '/pr', manifestDir, '/cf', priConfig, '/of', path.join(manifestDir, 'resources.pri'), '/o']);

const makeAppx = findSdkTool('makeappx.exe');
const signTool = findSdkTool('signtool.exe');
run(makeAppx, ['pack', '/o', '/nv', '/d', manifestDir, '/p', msix]);
run(signTool, ['sign', '/fd', 'SHA256', '/f', pfx, '/p', password, msix]);

console.log(`Sparse identity package prepared: ${msix}`);
console.log(`Public certificate prepared: ${cer}`);
console.log(`Side-by-side manifest prepared: ${appManifest}`);
