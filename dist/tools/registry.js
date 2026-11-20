export class ToolRegistry {
    tools = new Map();
    /**
     * Register a tool. If a tool with the same name already exists, it is
     * silently replaced (last-write-wins). Callers are responsible for
     * ensuring no unintended shadowing occurs at registration sites.
     */
    register(tool) {
        this.tools.set(tool.name, tool);
    }
    /**
     * Look up a tool by name. Returns `undefined` if no tool is registered
     * under that name.
     */
    get(name) {
        return this.tools.get(name);
    }
    listSpecs() {
        return Array.from(this.tools.values()).map((tool) => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters,
            },
        }));
    }
    /**
     * Whether a tool with the given args may mutate the filesystem or repo
     * state. Used by the orchestrator's lazy-checkpoint path to decide whether
     * a checkpoint is needed before dispatch. Unknown tools return false — the
     * orchestrator treats unknown tools as errors during dispatch, so they
     * never reach the mutate check at runtime.
     *
     * Conservative default: tools that omit `mutates` are treated as mutating
     * (return true). This errs on the side of paying the checkpoint cost when
     * in doubt, rather than risking an un-checkpointed mutation.
     */
    mayMutate(name, args) {
        const tool = this.tools.get(name);
        if (!tool)
            return false;
        return tool.mutates ? tool.mutates(args) : true;
    }
    async dispatch(name, args, ctx) {
        const tool = this.tools.get(name);
        if (!tool) {
            return { ok: false, error: `Unknown tool: ${name}` };
        }
        try {
            return await tool.execute(args, ctx);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return { ok: false, error: msg };
        }
    }
}
//# sourceMappingURL=registry.js.map