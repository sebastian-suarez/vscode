/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../nls.js';

/**
 * System-wide policy file path for Linux systems.
 */
export const LINUX_SYSTEM_POLICY_FILE_PATH = '/etc/vscode/policy.json';

export type PolicyName = string;
export type LocalizedValue = {
	key: string;
	value: string;
};

export type PolicyValue = string | number | boolean;

export enum PolicyCategory {
	Extensions = 'Extensions',
	Telemetry = 'Telemetry',
	Update = 'Update',
}

export const PolicyCategoryData: {
	[key in PolicyCategory]: { name: LocalizedValue }
} = {
	[PolicyCategory.Extensions]: {
		name: {
			key: 'extensionsConfigurationTitle', value: localize('extensionsConfigurationTitle', "Extensions"),
		}
	},
	[PolicyCategory.Telemetry]: {
		name: {
			key: 'telemetryConfigurationTitle', value: localize('telemetryConfigurationTitle', "Telemetry"),
		}
	},
	[PolicyCategory.Update]: {
		name: {
			key: 'updateConfigurationTitle', value: localize('updateConfigurationTitle', "Update"),
		}
	}
};

export interface IPolicy {

	/**
	 * The policy name.
	 */
	readonly name: PolicyName;

	/**
	 * The policy category.
	 */
	readonly category: PolicyCategory;

	/**
	 * The Code version in which this policy was introduced.
	*/
	readonly minimumVersion: `${number}.${number}`;

	/**
	 * Localization info for the policy.
	 *
	 * IMPORTANT: the key values for these must be unique to avoid collisions, as during the export time the module information is not available.
	 */
	readonly localization: {
		/** The localization key or key value pair. If only a key is provided, the default value will fallback to the parent configuration's description property. */
		description: LocalizedValue;
		/** List of localization key or key value pair. If only a key is provided, the default value will fallback to the parent configuration's enumDescriptions property. */
		enumDescriptions?: LocalizedValue[];
	};
}

/**
 * A subordinate attachment to an existing {@link IPolicy} (the "owner"). A setting may declare a
 * `policyReference` instead of a full `policy` to be governed by a policy owned by another setting,
 * letting a single enterprise policy lock more than one setting (e.g. gating an agent in both the
 * editor window and the Agents window).
 *
 * A reference is a pure pointer: it carries no policy semantics of its own. The owner is the single
 * source of truth for the policy's catalog metadata *and* its runtime behaviour (type, value
 * callback, etc.); a reference only contributes the policy name so the setting is gated and the OS
 * policy watcher observes the name in processes where the owner is not loaded.
 */
export interface IPolicyReference {

	/** The name of the owning {@link IPolicy} this setting attaches to. */
	readonly name: PolicyName;
}
