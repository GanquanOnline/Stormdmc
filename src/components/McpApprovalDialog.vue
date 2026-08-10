<template>
    <div class="mcp_approval_backdrop" v-if="pending">
        <section class="mcp_approval" role="dialog" aria-modal="true" aria-label="MCP 修改需要批准">
            <header>
                <div>
                    <h2>{{ exportOnly ? '批准 MCP 导出' : '批准 MCP 修改' }}</h2>
                    <p>{{ pending.brief || pending.documentPath || '粒子编辑' }}</p>
                </div>
                <Bot :size="24" />
            </header>

            <div class="approval_summary">
                <span>{{ pending.diff.length }} 个值已更改</span>
                <span>{{ pending.warnings.length }} 条警告</span>
                <code>{{ pending.documentPath }}</code>
            </div>

            <div class="approval_content">
                <div class="save_error" v-if="saveError">{{ saveError }}</div>
                <div class="warning_list" v-if="pending.warnings.length">
                    <div v-for="(warning, index) in pending.warnings" :key="'warning_'+index">{{ warning.text }}</div>
                </div>
                <div class="texture_compare" v-if="pending.before.texture.hasData || pending.after.texture.hasData">
                    <figure>
                        <figcaption>修改前</figcaption>
                        <div class="texture_preview"><img v-if="pending.before.texture.dataUrl" :src="pending.before.texture.dataUrl" alt="修改前纹理"></div>
                    </figure>
                    <figure>
                        <figcaption>修改后</figcaption>
                        <div class="texture_preview"><img v-if="pending.after.texture.dataUrl" :src="pending.after.texture.dataUrl" alt="修改后纹理"></div>
                    </figure>
                </div>
                <table>
                    <thead><tr><th>字段</th><th>修改前</th><th>修改后</th></tr></thead>
                    <tbody>
                        <tr v-for="(change, index) in visibleDiff" :key="change.path + index">
                            <td><code>{{ change.path }}</code></td>
                            <td>{{ formatValue(change.before) }}</td>
                            <td>{{ formatValue(change.after) }}</td>
                        </tr>
                    </tbody>
                </table>
                <p class="diff_more" v-if="pending.diff.length > visibleDiff.length">另有 {{ pending.diff.length - visibleDiff.length }} 项修改未展开。</p>
            </div>

            <footer>
                <button class="confirm_button" @click="approve" :disabled="busy"><Download v-if="exportOnly" :size="18" /><Save v-else :size="18" />{{ exportOnly ? '批准并导出' : '批准并保存' }}</button>
                <button @click="discard" :disabled="busy"><Undo2 :size="18" />放弃</button>
            </footer>
        </section>
    </div>
</template>

<script>
import {Bot, Download, Save, Undo2} from 'lucide-vue'

export default {
    name: 'mcp-approval-dialog',
    components: {Bot, Download, Save, Undo2},
    props: {runtime: Object},
    data() {return {pending: null, busy: false, unsubscribe: null, resultUnsubscribe: null, saveError: ''}},
    computed: {
        visibleDiff() {return this.pending ? this.pending.diff.slice(0, 80) : []},
        exportOnly() {return !!this.runtime?.status?.exportOnly || !this.runtime?.status?.workspace}
    },
    methods: {
        formatValue(value) {
            if (value === undefined) return 'undefined';
            const text = typeof value === 'string' ? value : JSON.stringify(value);
            return text.length > 120 ? text.slice(0, 117) + '...' : text;
        },
        async approve() {
            this.busy = true;
            this.saveError = '';
            try { await this.runtime.approvePending(this.pending.id); }
            catch (error) { this.saveError = error.message || String(error); this.busy = false; }
        },
        async discard() {
            this.busy = true;
            try { await this.runtime.discardPending(this.pending.id); }
            finally { this.busy = false; }
        }
    },
    mounted() {
        this.pending = this.runtime.pending;
        this.unsubscribe = this.runtime.on('pending', pending => this.pending = pending);
        this.resultUnsubscribe = this.runtime.on('approval_result', result => {
            if (result.status === 'failed') {
                this.saveError = result.warnings?.slice(-1)[0]?.text || '保存修改失败';
                this.busy = false;
            } else {
                this.pending = null;
                this.busy = false;
            }
        });
    },
    beforeDestroy() {
        if (this.unsubscribe) this.unsubscribe();
        if (this.resultUnsubscribe) this.resultUnsubscribe();
    }
}
</script>

<style scoped>
.mcp_approval_backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: rgba(0, 0, 0, 0.58);
}
.mcp_approval {
    display: flex;
    flex-direction: column;
    width: min(920px, 100%);
    max-height: calc(100vh - 40px);
    background: var(--color-interface);
    border: 1px solid var(--color-border);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
}
.mcp_approval > header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 18px;
    background: var(--color-bar);
    border-bottom: 1px solid var(--color-border);
}
.mcp_approval h2 {font-size: 20px;}
.mcp_approval header p {color: var(--color-text_grayed);}
.approval_summary {
    display: flex;
    gap: 16px;
    align-items: center;
    flex-wrap: wrap;
    padding: 10px 18px;
    border-bottom: 1px solid var(--color-border);
}
.approval_summary code {margin-left: auto;}
.approval_content {overflow: auto; padding: 12px 18px;}
.warning_list {padding: 8px 10px; margin-bottom: 10px; color: #ffc107; background: var(--color-dark);}
.save_error {padding: 8px 10px; margin-bottom: 10px; color: #ff6868; background: var(--color-dark);}
.texture_compare {display: flex; gap: 16px; margin-bottom: 12px; flex-wrap: wrap;}
.texture_compare figure {margin: 0; min-width: 96px;}
.texture_compare figcaption {color: var(--color-text_grayed); font-size: 12px; margin-bottom: 5px;}
.texture_preview {width: 96px; height: 96px; display: grid; place-items: center; background-color: #1b2024; border: 1px solid var(--color-border); background-image: linear-gradient(45deg, #252c31 25%, transparent 25%), linear-gradient(-45deg, #252c31 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #252c31 75%), linear-gradient(-45deg, transparent 75%, #252c31 75%); background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
.texture_preview img {max-width: 100%; max-height: 100%; image-rendering: pixelated;}
table {width: 100%; border-collapse: collapse; table-layout: fixed;}
th, td {padding: 7px 8px; border-bottom: 1px solid var(--color-border); text-align: left; overflow-wrap: anywhere; vertical-align: top;}
th:first-child, td:first-child {width: 34%;}
td:nth-child(2), td:nth-child(3) {font-family: var(--font-code); font-size: 12px;}
.diff_more {padding: 10px 0; color: var(--color-text_grayed);}
.mcp_approval > footer {display: flex; justify-content: flex-end; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--color-border);}
.mcp_approval button {display: flex; align-items: center; gap: 6px; min-width: 120px; justify-content: center;}
.confirm_button {background: var(--color-accent);}
@media (max-width: 720px) {
    .mcp_approval_backdrop {padding: 0;}
    .mcp_approval {max-height: 100vh; height: 100vh;}
    .approval_summary code {width: 100%; margin-left: 0;}
    th:first-child, td:first-child {width: 40%;}
}
</style>
