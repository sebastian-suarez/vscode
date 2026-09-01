/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


export interface IEntitlementsData {
	readonly access_type_sku: string;
	readonly organization_login_list: string[];
}

export interface IDefaultAccountAuthenticationProvider {
	readonly id: string;
	readonly name: string;
	readonly enterprise: boolean;
}

export interface IDefaultAccount {
	readonly authenticationProvider: IDefaultAccountAuthenticationProvider;
	readonly accountName: string;
	readonly sessionId: string;
	readonly enterprise: boolean;
	readonly entitlementsData?: IEntitlementsData | null;
}
