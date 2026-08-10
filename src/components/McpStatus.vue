<template>
    <div class="mcp_status" :class="{connected}" :title="connected ? (exportOnly ? 'MCP Bridge 已连接；浏览器导出模式' : 'MCP Bridge 已连接；工作区保存模式') : 'MCP Bridge 未连接'">
        <Wifi :size="17" v-if="connected" />
        <WifiOff :size="17" v-else />
        <span>{{ exportOnly ? 'MCP 导出' : 'MCP' }}</span>
    </div>
</template>

<script>
import {Wifi, WifiOff} from 'lucide-vue'

export default {
    name: 'mcp-status',
    components: {Wifi, WifiOff},
    props: {runtime: Object},
    data() {return {connected: false, exportOnly: false, unsubscribe: null}},
    mounted() {
        this.connected = !!this.runtime?.status?.connected;
        this.exportOnly = !!this.runtime?.status?.exportOnly;
        this.unsubscribe = this.runtime?.on('status', status => {this.connected = !!status.connected; this.exportOnly = !!status.exportOnly});
    },
    beforeDestroy() {
        if (this.unsubscribe) this.unsubscribe();
    }
}
</script>

<style scoped>
.mcp_status {
    position: fixed;
    top: 36px;
    right: 9px;
    height: 28px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 7px;
    color: var(--color-text_grayed);
    background-color: var(--color-dark);
    border: 1px solid var(--color-border);
    font-size: 12px;
    z-index: 4;
}
.mcp_status.connected {
    color: #50cca7;
}
</style>
