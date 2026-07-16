const fs = require('fs');
const path = require('path');

function exportDmg() {
  const rootDir = path.resolve(__dirname, '..');
  const tauriConfigPath = path.join(rootDir, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json');
  
  if (!fs.existsSync(tauriConfigPath)) {
    console.error(`Tauri configuration not found at: ${tauriConfigPath}`);
    process.exit(1);
  }
  
  const config = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
  const version = config.version;
  
  const bundleDmgDir = path.join(rootDir, 'apps', 'desktop', 'src-tauri', 'target', 'release', 'bundle', 'dmg');
  
  if (!fs.existsSync(bundleDmgDir)) {
    console.error(`Bundle directory not found: ${bundleDmgDir}`);
    console.error("Make sure to run 'tauri build' first.");
    process.exit(1);
  }
  
  const files = fs.readdirSync(bundleDmgDir);
  const dmgFiles = files.filter(f => f.endsWith('.dmg'));
  
  if (dmgFiles.length === 0) {
    console.error(`No .dmg files found in: ${bundleDmgDir}`);
    process.exit(1);
  }
  
  const exportsDir = path.join(rootDir, 'exports');
  if (!fs.existsSync(exportsDir)) {
    fs.mkdirSync(exportsDir, { recursive: true });
    console.log(`Created exports directory at: ${exportsDir}`);
  }
  
  for (const dmgFile of dmgFiles) {
    const srcPath = path.join(bundleDmgDir, dmgFile);
    const destPath = path.join(exportsDir, dmgFile);
    
    fs.copyFileSync(srcPath, destPath);
    console.log(`Successfully exported: ${dmgFile} -> exports/`);
  }
}

exportDmg();
