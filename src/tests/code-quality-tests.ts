/**
 * 🧪 CODE QUALITY TESTING FRAMEWORK
 *
 * File ini berisi test untuk code quality:
 * - TypeScript compilation
 * - Linting compliance
 * - Build success
 * - Code formatting
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const workspaceRoot = process.cwd();

function runCommand(cmd: string): string {
	return execSync(cmd, {
		cwd: workspaceRoot,
		encoding: 'utf8',
		stdio: 'pipe',
		shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
		env: process.env
	});
}

function commandErrorDetails(error: unknown): string {
	const value = error as Error & { stdout?: string; stderr?: string };
	return [value.stdout, value.stderr, value.message].filter(Boolean).join('\n').trim();
}

// ============================================================================
// [CATATAN]: 📋 TEST INTERFACES
// ============================================================================

export interface CodeQualityTestResult {
	name: string;
	success: boolean;
	message: string;
	details?: string;
	executionTime?: number;
}

export interface CodeQualityTest {
	name: string;
	deskripsi: string;
	test: () => Promise<CodeQualityTestResult>;
}

export interface CodeQualityTestSuiteDef {
	name: string;
	tests: CodeQualityTest[];
}

export interface CodeQualityTestSuite {
	name: string;
	tests: CodeQualityTestResult[];
	totalTests: number;
	passedTests: number;
	failedTests: number;
	executionTime: number;
}

// ============================================================================
// [CATATAN]: 🧪 TYPE SCRIPT TESTS
// ============================================================================

export const typescriptTests: CodeQualityTestSuiteDef = {
	name: 'TypeScript Compilation',
	tests: [
		{
			name: 'TypeScript Check',
			deskripsi: 'Svelte sync dan typecheck harus berhasil tanpa error',
			test: async (): Promise<CodeQualityTestResult> => {
				const startTime = Date.now();

				try {
					console.log('🔍 Running TypeScript check...');
					runCommand('pnpm check');

					const executionTime = Date.now() - startTime;

					return {
						name: 'TypeScript Check',
						success: true,
						message: 'TypeScript compilation successful',
						details: 'All TypeScript files compiled without errors',
						executionTime
					};
				} catch (error: unknown) {
					const executionTime = Date.now() - startTime;
					return {
						name: 'TypeScript Check',
						success: false,
						message: 'TypeScript compilation failed',
						details: commandErrorDetails(error),
						executionTime
					};
				}
			}
		},
		{
			name: 'TypeScript Build',
			deskripsi: 'Production build harus berhasil',
			test: async (): Promise<CodeQualityTestResult> => {
				const startTime = Date.now();

				try {
					console.log('🏗️ Running TypeScript build...');
					runCommand('pnpm build');

					const executionTime = Date.now() - startTime;

					return {
						name: 'TypeScript Build',
						success: true,
						message: 'Build successful',
						details: 'Application built without errors',
						executionTime
					};
				} catch (error: unknown) {
					const executionTime = Date.now() - startTime;
					return {
						name: 'TypeScript Build',
						success: false,
						message: 'Build failed',
						details: commandErrorDetails(error),
						executionTime
					};
				}
			}
		}
	]
};

// ============================================================================
// [CATATAN]: 🧪 LINTING TESTS
// ============================================================================

export const lintingTests: CodeQualityTestSuiteDef = {
	name: 'Code Linting',
	tests: [
		{
			name: 'ESLint Check',
			deskripsi: 'ESLint harus pass tanpa error',
			test: async (): Promise<CodeQualityTestResult> => {
				const startTime = Date.now();

				try {
					console.log('🔍 Running ESLint check...');
					runCommand('pnpm eslint .');

					const executionTime = Date.now() - startTime;

					return {
						name: 'ESLint Check',
						success: true,
						message: 'ESLint passed',
						details: 'No linting errors found',
						executionTime
					};
				} catch (error: unknown) {
					const executionTime = Date.now() - startTime;
					return {
						name: 'ESLint Check',
						success: false,
						message: 'ESLint failed',
						details: commandErrorDetails(error),
						executionTime
					};
				}
			}
		},
		{
			name: 'Prettier Format Check',
			deskripsi: 'Code formatting harus sesuai standar',
			test: async (): Promise<CodeQualityTestResult> => {
				const startTime = Date.now();

				try {
					console.log('🎨 Checking code formatting...');
					runCommand('pnpm prettier --check .');

					const executionTime = Date.now() - startTime;

					return {
						name: 'Prettier Format Check',
						success: true,
						message: 'Code formatting is correct',
						details: 'All files follow formatting standards',
						executionTime
					};
				} catch (error: unknown) {
					const executionTime = Date.now() - startTime;
					return {
						name: 'Prettier Format Check',
						success: false,
						message: 'Code formatting issues found',
						details: commandErrorDetails(error),
						executionTime
					};
				}
			}
		}
	]
};

// ============================================================================
// [CATATAN]: 🧪 FILE STRUCTURE TESTS
// ============================================================================

export const fileStructureTests: CodeQualityTestSuiteDef = {
	name: 'File Structure',
	tests: [
		{
			name: 'Required Files Exist',
			deskripsi: 'File-file penting harus ada',
			test: async (): Promise<CodeQualityTestResult> => {
				const startTime = Date.now();

				try {
					const requiredFiles = [
						'package.json',
						'tsconfig.json',
						'vite.config.ts',
						'svelte.config.js',
						'tailwind.config.js',
						'eslint.config.js',
						'src/app.html',
						'src/app.css',
						'src/routes/+layout.svelte',
						'src/routes/+page.svelte'
					];

					const missingFiles: string[] = [];

					for (const file of requiredFiles) {
						if (!fs.existsSync(file)) {
							missingFiles.push(file);
						}
					}

					const executionTime = Date.now() - startTime;

					if (missingFiles.length === 0) {
						return {
							name: 'Required Files Exist',
							success: true,
							message: 'All required files present',
							details: `Found ${requiredFiles.length} required files`,
							executionTime
						};
					} else {
						return {
							name: 'Required Files Exist',
							success: false,
							message: 'Missing required files',
							details: `Missing: ${missingFiles.join(', ')}`,
							executionTime
						};
					}
				} catch (error: unknown) {
					const executionTime = Date.now() - startTime;
					const e = error as Error;

					return {
						name: 'Required Files Exist',
						success: false,
						message: 'File check failed',
						details: e.message,
						executionTime
					};
				}
			}
		},
		{
			name: 'Directory Structure',
			deskripsi: 'Struktur folder harus sesuai standar',
			test: async (): Promise<CodeQualityTestResult> => {
				const startTime = Date.now();

				try {
					const requiredDirs = [
						'src',
						'src/lib',
						'src/routes',
						'src/lib/components',
						'src/lib/stores',
						'src/lib/services',
						'src/lib/utils',
						'src/lib/auth',
						'src/lib/database'
					];

					const missingDirs: string[] = [];

					for (const dir of requiredDirs) {
						if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
							missingDirs.push(dir);
						}
					}

					const executionTime = Date.now() - startTime;

					if (missingDirs.length === 0) {
						return {
							name: 'Directory Structure',
							success: true,
							message: 'Directory structure is correct',
							details: `All ${requiredDirs.length} required directories present`,
							executionTime
						};
					} else {
						return {
							name: 'Directory Structure',
							success: false,
							message: 'Directory structure issues',
							details: `Missing: ${missingDirs.join(', ')}`,
							executionTime
						};
					}
				} catch (error: unknown) {
					const executionTime = Date.now() - startTime;
					const e = error as Error;

					return {
						name: 'Directory Structure',
						success: false,
						message: 'Directory check failed',
						details: e.message,
						executionTime
					};
				}
			}
		}
	]
};

// ============================================================================
// [CATATAN]: 🧪 DEPENDENCY TESTS
// ============================================================================

export const dependencyTests: CodeQualityTestSuiteDef = {
	name: 'Dependencies',
	tests: [
		{
			name: 'Package.json Valid',
			deskripsi: 'package.json harus valid dan lengkap',
			test: async (): Promise<CodeQualityTestResult> => {
				const startTime = Date.now();

				try {
					const packagePath = path.join(process.cwd(), 'package.json');
					const packageContent = fs.readFileSync(packagePath, 'utf8');
					const packageJson = JSON.parse(packageContent);

					const requiredFields = ['name', 'version', 'scripts', 'dependencies', 'devDependencies'];
					const missingFields: string[] = [];

					for (const field of requiredFields) {
						if (!packageJson[field]) {
							missingFields.push(field);
						}
					}

					const executionTime = Date.now() - startTime;

					if (missingFields.length === 0) {
						return {
							name: 'Package.json Valid',
							success: true,
							message: 'Package.json is valid',
							details: `All required fields present: ${requiredFields.join(', ')}`,
							executionTime
						};
					} else {
						return {
							name: 'Package.json Valid',
							success: false,
							message: 'Package.json missing fields',
							details: `Missing: ${missingFields.join(', ')}`,
							executionTime
						};
					}
				} catch (error: unknown) {
					const executionTime = Date.now() - startTime;
					const e = error as Error;

					return {
						name: 'Package.json Valid',
						success: false,
						message: 'Package.json validation failed',
						details: e.message,
						executionTime
					};
				}
			}
		},
		{
			name: 'Dependencies Installed',
			deskripsi: 'Semua dependencies harus terinstall',
			test: async (): Promise<CodeQualityTestResult> => {
				const startTime = Date.now();

				try {
					const nodeModulesPath = path.join(process.cwd(), 'node_modules');
					const packageLockPath = path.join(process.cwd(), 'pnpm-lock.yaml');

					const nodeModulesExists = fs.existsSync(nodeModulesPath);
					const packageLockExists = fs.existsSync(packageLockPath);

					const executionTime = Date.now() - startTime;

					if (nodeModulesExists && packageLockExists) {
						return {
							name: 'Dependencies Installed',
							success: true,
							message: 'Dependencies are installed',
							details: 'node_modules and pnpm-lock.yaml found',
							executionTime
						};
					} else {
						return {
							name: 'Dependencies Installed',
							success: false,
							message: 'Dependencies not installed',
							details: `node_modules: ${nodeModulesExists}, pnpm-lock.yaml: ${packageLockExists}`,
							executionTime
						};
					}
				} catch (error: unknown) {
					const executionTime = Date.now() - startTime;
					const e = error as Error;

					return {
						name: 'Dependencies Installed',
						success: false,
						message: 'Dependency check failed',
						details: e.message,
						executionTime
					};
				}
			}
		}
	]
};

// ============================================================================
// [CATATAN]: 🧪 TEST RUNNER
// ============================================================================

export class CodeQualityTestRunner {
	private testSuites = [typescriptTests, lintingTests, fileStructureTests, dependencyTests];

	/**
	 * Jalankan semua test suite
	 */
	async runAllTests(): Promise<CodeQualityTestSuite[]> {
		console.log('🧪 Starting Code Quality Tests...\n');

		const results: CodeQualityTestSuite[] = [];

		for (const suite of this.testSuites) {
			console.log(`📋 Running ${suite.name}...`);
			const result = await this.runTestSuite(suite);
			results.push(result);

			// [CATATAN]: Log results
			console.log(`✅ ${result.passedTests}/${result.totalTests} tests passed`);
			if (result.failedTests > 0) {
				console.log(`❌ ${result.failedTests} tests failed`);
			}
			console.log('');
		}

		return results;
	}

	/**
	 * Jalankan satu test suite
	 */
	private async runTestSuite(suite: CodeQualityTestSuiteDef): Promise<CodeQualityTestSuite> {
		const startTime = Date.now();
		const results: CodeQualityTestResult[] = [];

		for (const test of suite.tests) {
			try {
				const result = await test.test();
				results.push(result);

				// [CATATAN]: Log individual test result
				const status = result.success ? '✅' : '❌';
				console.log(`  ${status} ${result.name}: ${result.message}`);
			} catch (error: unknown) {
				const e = error as Error;
				results.push({
					name: test.name,
					success: false,
					message: 'Test execution failed',
					details: e.message
				});

				console.log(`  ❌ ${test.name}: Test execution failed - ${e.message}`);
			}
		}

		const totalExecutionTime = Date.now() - startTime;
		const passedTests = results.filter((r) => r.success).length;
		const failedTests = results.filter((r) => !r.success).length;

		return {
			name: suite.name,
			totalTests: suite.tests.length,
			passedTests,
			failedTests,
			tests: results,
			executionTime: totalExecutionTime
		};
	}

	/**
	 * Jalankan test untuk kategori tertentu
	 */
	async runCategoryTests(categoryName: string): Promise<CodeQualityTestSuite | null> {
		const suite = this.testSuites.find((s) =>
			s.name.toLowerCase().includes(categoryName.toLowerCase())
		);

		if (!suite) {
			console.log(`❌ Category "${categoryName}" not found`);
			return null;
		}

		return await this.runTestSuite(suite);
	}

	/**
	 * Generate test report
	 */
	generateReport(results: CodeQualityTestSuite[]): string {
		let report = '# 🧪 CODE QUALITY TEST REPORT\n\n';
		report += `**Generated:** ${new Date().toLocaleString()}\n\n`;

		const totalTests = results.reduce((sum, suite) => sum + suite.totalTests, 0);
		const totalPassed = results.reduce((sum, suite) => sum + suite.passedTests, 0);
		const totalFailed = results.reduce((sum, suite) => sum + suite.failedTests, 0);
		const totalTime = results.reduce((sum, suite) => sum + suite.executionTime, 0);

		report += `## 📊 SUMMARY\n\n`;
		report += `- **Total Tests:** ${totalTests}\n`;
		report += `- **Passed:** ${totalPassed} ✅\n`;
		report += `- **Failed:** ${totalFailed} ❌\n`;
		report += `- **Success Rate:** ${((totalPassed / totalTests) * 100).toFixed(1)}%\n`;
		report += `- **Total Time:** ${totalTime}ms\n\n`;

		for (const suite of results) {
			report += `## ${suite.name}\n\n`;
			report += `- **Tests:** ${suite.passedTests}/${suite.totalTests} passed\n`;
			report += `- **Time:** ${suite.executionTime}ms\n\n`;

			for (const test of suite.tests) {
				const status = test.success ? '✅' : '❌';
				report += `### ${status} ${test.name}\n`;
				report += `- **Status:** ${test.success ? 'PASSED' : 'FAILED'}\n`;
				report += `- **Message:** ${test.message}\n`;
				if (test.details) {
					report += `- **Details:** ${test.details}\n`;
				}
				if (test.executionTime) {
					report += `- **Time:** ${test.executionTime}ms\n`;
				}
				report += '\n';
			}
		}

		return report;
	}
}

// ============================================================================
// [CATATAN]: 🚀 QUICK TEST FUNCTIONS
// ============================================================================

/**
 * Jalankan test cepat untuk kategori tertentu
 */
export async function quickCodeQualityTest(categoryName: string): Promise<CodeQualityTestResult[]> {
	const runner = new CodeQualityTestRunner();
	const result = await runner.runCategoryTests(categoryName);

	if (!result) {
		return [];
	}

	return result.tests;
}

/**
 * Jalankan semua test dan generate report
 */
export async function runFullCodeQualityTestSuite(): Promise<string> {
	const runner = new CodeQualityTestRunner();
	const results = await runner.runAllTests();
	return runner.generateReport(results);
}

export function hasCodeQualityFailures(results: CodeQualityTestSuite[]): boolean {
	return results.some((suite) => suite.failedTests > 0);
}

/**
 * Test individual kategori
 */
export async function testTypeScript(): Promise<CodeQualityTestResult[]> {
	return await quickCodeQualityTest('TypeScript');
}

export async function testLinting(): Promise<CodeQualityTestResult[]> {
	return await quickCodeQualityTest('Code Linting');
}

export async function testFileStructure(): Promise<CodeQualityTestResult[]> {
	return await quickCodeQualityTest('File Structure');
}

export async function testDependencies(): Promise<CodeQualityTestResult[]> {
	return await quickCodeQualityTest('Dependencies');
}

// ============================================================================
// [CATATAN]: 🚀 CLI EXECUTION
// ============================================================================

/**
 * CLI entry point untuk code quality testing
 */
async function main() {
	const args = process.argv.slice(2);
	const command = args[0];

	console.log('🧪 ZATIARAS POS CODE QUALITY TESTING');
	console.log('=====================================\n');

	try {
		if (!command || command === 'all') {
			// [CATATAN]: Test semua code quality
			console.log('🚀 Running all code quality tests...\n');
			const runner = new CodeQualityTestRunner();
			const results = await runner.runAllTests();
			const report = runner.generateReport(results);

			// [CATATAN]: Save report to file
			const fs = await import('fs');
			const path = await import('path');
			const reportPath = path.join(process.cwd(), 'code-quality-report.md');
			fs.writeFileSync(reportPath, report);

			console.log(`\n📄 Code quality report saved to: ${reportPath}`);

			if (hasCodeQualityFailures(results)) {
				process.exit(1);
			}
		} else if (command === 'typescript') {
			// [CATATAN]: Test TypeScript saja
			console.log('🔍 Testing TypeScript Compilation...\n');
			const results = await quickCodeQualityTest('TypeScript');
			displayQuickTestResults('TypeScript', results);
		} else if (command === 'linting') {
			// [CATATAN]: Test linting saja
			console.log('🔍 Testing Code Linting...\n');
			const results = await quickCodeQualityTest('Code Linting');
			displayQuickTestResults('Code Linting', results);
		} else if (command === 'structure') {
			// [CATATAN]: Test file structure saja
			console.log('📁 Testing File Structure...\n');
			const results = await quickCodeQualityTest('File Structure');
			displayQuickTestResults('File Structure', results);
		} else if (command === 'dependencies') {
			// [CATATAN]: Test dependencies saja
			console.log('📦 Testing Dependencies...\n');
			const results = await quickCodeQualityTest('Dependencies');
			displayQuickTestResults('Dependencies', results);
		} else if (command === 'help') {
			// [CATATAN]: Show help
			showHelp();
		} else {
			console.log(`❌ Unknown command: ${command}`);
			showHelp();
			process.exit(1);
		}
	} catch (error) {
		console.error('❌ Test execution failed:', error);
		process.exit(1);
	}
}

function displayQuickTestResults(categoryName: string, results: CodeQualityTestResult[]) {
	console.log(`📋 ${categoryName} Test Results:\n`);

	let passed = 0;
	let failed = 0;

	for (const result of results) {
		const status = result.success ? '✅' : '❌';
		console.log(`  ${status} ${result.name}: ${result.message}`);

		if (result.success) {
			passed++;
		} else {
			failed++;
			if (result.details) {
				console.log(`     Details: ${result.details}`);
			}
		}
	}

	console.log(`\n📊 Summary: ${passed} passed, ${failed} failed`);

	if (failed > 0) {
		process.exit(1);
	}
}

function showHelp() {
	console.log(`
📖 USAGE:

  tsx src/tests/code-quality-tests.ts [command]

📋 COMMANDS:

  all          - Test semua code quality (default)
  typescript   - Test TypeScript compilation saja
  linting      - Test code linting saja
  structure    - Test file structure saja
  dependencies - Test dependencies saja
  help         - Tampilkan bantuan ini

🎯 EXAMPLES:

  tsx src/tests/code-quality-tests.ts              # Test semua code quality
  tsx src/tests/code-quality-tests.ts typescript   # Test TypeScript saja
  tsx src/tests/code-quality-tests.ts linting      # Test linting saja

📄 OUTPUT:

  - Console output dengan hasil test
  - Code quality report disimpan ke code-quality-report.md (untuk test all)
  - Exit code 0 jika semua test passed, 1 jika ada yang failed
`);
}

// [CATATAN]: Check if this is the main module
if (process.argv[1] && process.argv[1].endsWith('code-quality-tests.ts')) {
	main().catch((error) => {
		console.error('❌ Script execution failed:', error);
		process.exit(1);
	});
}
