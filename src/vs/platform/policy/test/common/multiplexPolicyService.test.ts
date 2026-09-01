/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IStringDictionary } from '../../../../base/common/collections.js';
import { PolicyName } from '../../../../base/common/policy.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { NullLogService } from '../../../log/common/log.js';
import { AbstractPolicyService, PolicyDefinition, PolicyValue } from '../../common/policy.js';
import { MultiplexPolicyService } from '../../common/multiplexPolicyService.js';

class TestPolicyService extends AbstractPolicyService {

	constructor(private readonly values: IStringDictionary<PolicyValue>) {
		super();
	}

	protected async _updatePolicyDefinitions(policyDefinitions: IStringDictionary<PolicyDefinition>): Promise<void> {
		// Report a value for every definition this service knows about.
		for (const name of Object.keys(policyDefinitions)) {
			const value = this.values[name];
			if (value !== undefined) {
				this.policies.set(name, value);
			}
		}
	}

	setPolicyValue(name: PolicyName, value: PolicyValue): void {
		this.policies.set(name, value);
		this._onDidChange.fire([name]);
	}
}

suite('MultiplexPolicyService', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const definitions: IStringDictionary<PolicyDefinition> = {
		'PolicyA': { type: 'string' },
		'PolicyB': { type: 'boolean' },
	};

	test('combines the values of all underlying services', async () => {
		const first = store.add(new TestPolicyService({ 'PolicyA': 'from-first' }));
		const second = store.add(new TestPolicyService({ 'PolicyB': true }));
		const service = store.add(new MultiplexPolicyService([first, second], new NullLogService()));

		const values = await service.updatePolicyDefinitions(definitions);

		assert.deepStrictEqual(values, { 'PolicyA': 'from-first', 'PolicyB': true });
		assert.strictEqual(service.getPolicyValue('PolicyA'), 'from-first');
		assert.strictEqual(service.getPolicyValue('PolicyB'), true);
	});

	test('the last service that reports a value wins', async () => {
		const first = store.add(new TestPolicyService({ 'PolicyA': 'from-first' }));
		const second = store.add(new TestPolicyService({ 'PolicyA': 'from-second' }));
		const service = store.add(new MultiplexPolicyService([first, second], new NullLogService()));

		await service.updatePolicyDefinitions(definitions);

		assert.strictEqual(service.getPolicyValue('PolicyA'), 'from-second');
	});

	test('a definition without a value in any service stays undefined', async () => {
		const first = store.add(new TestPolicyService({ 'PolicyA': 'from-first' }));
		const service = store.add(new MultiplexPolicyService([first], new NullLogService()));

		await service.updatePolicyDefinitions(definitions);

		assert.strictEqual(service.getPolicyValue('PolicyB'), undefined);
	});

	test('forwards definitions to every underlying service', async () => {
		const first = store.add(new TestPolicyService({ 'PolicyA': 'from-first' }));
		const second = store.add(new TestPolicyService({ 'PolicyB': false }));
		const service = store.add(new MultiplexPolicyService([first, second], new NullLogService()));

		await service.updatePolicyDefinitions(definitions);

		assert.deepStrictEqual(Object.keys(first.policyDefinitions).sort(), ['PolicyA', 'PolicyB']);
		assert.deepStrictEqual(Object.keys(second.policyDefinitions).sort(), ['PolicyA', 'PolicyB']);
	});

	test('a change in an underlying service is picked up and forwarded', async () => {
		const first = store.add(new TestPolicyService({ 'PolicyA': 'from-first' }));
		const service = store.add(new MultiplexPolicyService([first], new NullLogService()));
		await service.updatePolicyDefinitions(definitions);

		const changes: PolicyName[][] = [];
		store.add(service.onDidChange(names => changes.push([...names])));

		first.setPolicyValue('PolicyA', 'updated');

		assert.deepStrictEqual(changes, [['PolicyA']]);
		assert.strictEqual(service.getPolicyValue('PolicyA'), 'updated');
	});
});
