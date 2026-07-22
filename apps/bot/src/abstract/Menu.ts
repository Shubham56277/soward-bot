import BaseClient from "../base/Client";

export interface MenuOptions {
	id: string;
	execute?: (...args: any) => any;
}
export default abstract class Menu {
	public id: string;
	constructor(
		protected readonly client: BaseClient,
		options: MenuOptions,
	) {
		this.id = options.id;
	}
	public async execute(..._args: any): Promise<void> {}
}
