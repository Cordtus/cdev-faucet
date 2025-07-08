#!/usr/bin/env node
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const packagePath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

// Get current version
const currentVersion = packageJson.version;
const parts = currentVersion.split('.');

// Bump patch version by default
const patchVersion = parseInt(parts[2]) + 1;
const newVersion = `${parts[0]}.${parts[1]}.${patchVersion}`;

// Update package.json
packageJson.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');

// Update Header.vue
const headerPath = join(__dirname, '..', 'src', 'components', 'Header.vue');
let headerContent = fs.readFileSync(headerPath, 'utf8');
headerContent = headerContent.replace(
  /const version = ['"][\d.]+['"]/,
  `const version = '${newVersion}'`
);
fs.writeFileSync(headerPath, headerContent);

console.log(`Version bumped from ${currentVersion} to ${newVersion}`);
console.log('Updated: package.json and src/components/Header.vue');