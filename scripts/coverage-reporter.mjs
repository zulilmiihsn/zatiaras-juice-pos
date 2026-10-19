import { normalizeCoverageSummary } from './coverage-policy.mjs';

/** @param {AsyncIterable<unknown>} source */
export default async function* coverageReporter(source) {
	let recorded = false;
	for await (const event of source) {
		if (!event || typeof event !== 'object' || !('type' in event) || event.type !== 'test:coverage')
			continue;
		if (
			!('data' in event) ||
			!event.data ||
			typeof event.data !== 'object' ||
			!('summary' in event.data)
		)
			throw new Error('Coverage event has no summary');
		yield JSON.stringify({
			...normalizeCoverageSummary(event.data.summary, process.version),
			scope: process.env.ZATIARAS_COVERAGE_SCOPE || 'diagnostic'
		}) + '\n';
		recorded = true;
	}
	if (!recorded) throw new Error('Native test runner emitted no coverage event');
}
