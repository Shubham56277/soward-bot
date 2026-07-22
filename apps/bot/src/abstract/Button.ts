import BaseClient from "../base/Client";

export interface ButtonOptions {
	id: string;
	execute?: (...args: any) => any;
}
export default abstract class Button {
	public id: string;
	constructor(
		protected readonly client: BaseClient,
		options: ButtonOptions,
	) {
		this.id = options.id;
	}
	public async execute(..._args: any): Promise<void> {}
}
