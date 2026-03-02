import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type Alias = {
	description: string;
	action: "shutdown";
};

const ALIASES: Record<string, Alias> = {
	exit: {
		description: "Alias for /quit",
		action: "shutdown",
	},
};

export default function aliasesExtension(pi: ExtensionAPI) {
	for (const [name, alias] of Object.entries(ALIASES)) {
		pi.registerCommand(name, {
			description: alias.description,
			handler: async (_args, ctx) => {
				switch (alias.action) {
					case "shutdown":
						ctx.shutdown();
						return;
				}
			},
		});
	}
}
