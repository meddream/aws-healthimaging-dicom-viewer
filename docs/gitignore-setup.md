# Git Ignore Configuration

This document describes the `.gitignore` configuration for the AWS HealthImaging DICOM Viewer project.

## Overview

The project uses multiple `.gitignore` files to exclude unnecessary files from version control:

1. **Root `.gitignore`** - Global exclusions for the entire project
2. **`infrastructure/.gitignore`** - CDK-specific exclusions
3. **`uploader/App/.gitignore`** - React application exclusions

## Files Excluded

### Root Level (`.gitignore`)

#### CDK Infrastructure
- `cdk.out/` - CDK synthesis output
- `cdk.context.json` - CDK context cache
- `infrastructure/cdk.out/` - CDK output directory
- `infrastructure/*.js` - Compiled JavaScript files
- `infrastructure/lib/*.js` - Compiled library files
- `infrastructure/bin/*.js` - Compiled binary files
- `infrastructure/lambda/*/node_modules/` - Lambda function dependencies

#### React Application
- `uploader/App/build/` - Production build output
- `uploader/App/dist/` - Distribution files
- `uploader/App/.react-router/` - React Router build cache
- `uploader/App/node_modules/` - Node.js dependencies

#### System Files
- `.DS_Store` - macOS system files
- `.DS_Store?` - macOS system files
- `._*` - macOS resource fork files
- `.Spotlight-V100` - macOS Spotlight index
- `.Trashes` - macOS trash folder
- `ehthumbs.db` - Windows thumbnail cache
- `Thumbs.db` - Windows thumbnail cache

#### IDE Files
- `.vscode/` - Visual Studio Code settings
- `.idea/` - IntelliJ IDEA settings
- `*.swp` - Vim swap files
- `*.swo` - Vim swap files
- `*~` - Backup files

#### Logs and Debug Files
- `*.log` - Log files
- `npm-debug.log*` - npm debug logs
- `yarn-debug.log*` - Yarn debug logs
- `yarn-error.log*` - Yarn error logs
- `lerna-debug.log*` - Lerna debug logs

#### Environment Files
- `.env` - Environment variables
- `.env.local` - Local environment variables
- `.env.development.local` - Development environment
- `.env.test.local` - Test environment
- `.env.production.local` - Production environment

#### Temporary Files
- `*.tmp` - Temporary files
- `*.temp` - Temporary files
- `.cache/` - Cache directories
- `.temp/` - Temporary directories

#### AWS and CloudFormation
- `.aws/` - AWS CLI configuration
- `credentials` - AWS credentials
- `config` - AWS configuration
- `*.template` - CloudFormation templates
- `*.yaml` - YAML files
- `*.yml` - YAML files
- `*.zip` - Lambda deployment packages

#### Testing and Coverage
- `coverage/` - Test coverage reports
- `.nyc_output/` - NYC coverage output
- `*.lcov` - LCOV coverage files

#### TypeScript
- `*.tsbuildinfo` - TypeScript build info

#### Package Managers
- `package-lock.json` - npm lock file
- `yarn.lock` - Yarn lock file
- `pnpm-lock.yaml` - pnpm lock file

### Infrastructure Level (`infrastructure/.gitignore`)

#### CDK Specific
- `cdk.out/` - CDK synthesis output
- `cdk.context.json` - CDK context cache

#### Compiled Files
- `*.js` - Compiled JavaScript files
- `*.d.ts` - TypeScript declaration files
- `*.js.map` - Source map files

#### TypeScript
- `*.tsbuildinfo` - TypeScript build info

#### Dependencies
- `node_modules/` - Node.js dependencies

#### Logs
- `*.log` - Log files
- `npm-debug.log*` - npm debug logs

#### Environment
- `.env` - Environment variables
- `.env.local` - Local environment variables

#### System Files
- `.DS_Store` - macOS system files
- `.DS_Store?` - macOS system files

#### IDE Files
- `.vscode/` - Visual Studio Code settings
- `.idea/` - IntelliJ IDEA settings

#### AWS
- `.aws/` - AWS CLI configuration
- `credentials` - AWS credentials
- `config` - AWS configuration

#### CloudFormation
- `*.template` - CloudFormation templates
- `*.yaml` - YAML files
- `*.yml` - YAML files

#### Lambda
- `*.zip` - Lambda deployment packages

#### Testing
- `coverage/` - Test coverage reports
- `.nyc_output/` - NYC coverage output

#### Temporary Files
- `*.tmp` - Temporary files
- `*.temp` - Temporary files
- `.cache/` - Cache directories
- `.temp/` - Temporary directories

### Uploader App Level (`uploader/App/.gitignore`)

#### Dependencies
- `node_modules/` - Node.js dependencies

#### Build Output
- `build/` - Production build
- `dist/` - Distribution files
- `.react-router/` - React Router build

#### Environment Files
- `.env` - Environment variables
- `.env.local` - Local environment variables
- `.env.development.local` - Development environment
- `.env.test.local` - Test environment
- `.env.production.local` - Production environment

#### Logs
- `*.log` - Log files
- `npm-debug.log*` - npm debug logs
- `yarn-debug.log*` - Yarn debug logs
- `yarn-error.log*` - Yarn error logs

#### Runtime Data
- `pids` - Process IDs
- `*.pid` - Process ID files
- `*.seed` - Seed files
- `*.pid.lock` - Process ID lock files

#### Coverage
- `coverage/` - Coverage directory
- `*.lcov` - LCOV coverage files
- `.nyc_output` - NYC test coverage

#### Dependencies
- `jspm_packages/` - JSPM packages

#### npm
- `.npm` - npm cache directory
- `*.tgz` - npm pack output
- `.yarn-integrity` - Yarn integrity file

#### ESLint
- `.eslintcache` - ESLint cache

#### REPL
- `.node_repl_history` - Node.js REPL history

#### Environment
- `.env` - Environment variables

#### Bundlers
- `.cache` - Parcel cache
- `.parcel-cache` - Parcel cache

#### Frameworks
- `.next` - Next.js build output
- `.nuxt` - Nuxt.js build output
- `.vuepress/dist` - VuePress build output

#### Serverless
- `.serverless/` - Serverless directories

#### FuseBox
- `.fusebox/` - FuseBox cache

#### DynamoDB
- `.dynamodb/` - DynamoDB Local files

#### System Files
- `.DS_Store` - macOS system files
- `.DS_Store?` - macOS system files
- `._*` - macOS resource fork files
- `.Spotlight-V100` - macOS Spotlight index
- `.Trashes` - macOS trash folder
- `ehthumbs.db` - Windows thumbnail cache
- `Thumbs.db` - Windows thumbnail cache

#### IDE Files
- `.vscode/` - Visual Studio Code settings
- `.idea/` - IntelliJ IDEA settings
- `*.swp` - Vim swap files
- `*.swo` - Vim swap files
- `*~` - Backup files

#### Temporary Files
- `*.tmp` - Temporary files
- `*.temp` - Temporary files
- `.cache/` - Cache directories
- `.temp/` - Temporary directories

#### TypeScript
- `*.tsbuildinfo` - TypeScript build info

## Benefits

1. **Clean Repository**: Excludes build artifacts and temporary files
2. **Security**: Prevents accidental commit of credentials and environment files
3. **Performance**: Reduces repository size and clone time
4. **Consistency**: Ensures all developers have the same ignored files
5. **CDK Best Practices**: Follows AWS CDK recommendations for ignored files

## Maintenance

- Review and update `.gitignore` files when adding new build tools or frameworks
- Remove any accidentally committed files that should be ignored
- Keep the documentation updated when adding new exclusions

## Commands

### Remove accidentally committed files
```bash
# Remove files from git tracking but keep them locally
git rm --cached <file>

# Remove directories from git tracking
git rm -r --cached <directory>

# Apply .gitignore to already tracked files
git rm -r --cached .
git add .
git commit -m "Apply .gitignore rules"
```

### Check what files are being ignored
```bash
# Check if a file is ignored
git check-ignore <file>

# List all ignored files
git status --ignored
```
