<template>
	<section>
		<div v-for="(input, inp_key) of inputs" :class="{input_help: true, visible: isInputVisible(inp_key)}">
			<h2>
				<Brackets v-if="input.type == 'molang'" title="Molang" />
				<WholeWord v-else-if="input.type == 'text'" title="文本" />
				<CheckSquare v-else-if="input.type == 'toggle'" title="开关" />
				<Menu v-else-if="input.type == 'select'" title="选择" />
				<Gauge v-else-if="input.type == 'number'" title="数字" />
				<Palette v-else-if="input.type == 'color'" title="颜色" />
				<Zap v-else-if="input.type == 'event_trigger'" title="事件触发器" />
				{{ input.label || getInput(inp_key).label }}
			</h2>
			<div v-if="input.type == 'molang'" class="input_info_bar">
				<span class="input_type_label">{{ labels[input.type] }}</span>
				<span class="input_context_label" v-if="input.type == 'molang'" :style="{backgroundColor: input_context_color[input.context||'emitter']}">{{ labels[input.context||'emitter'] }}</span>
				<span class="input_evaluation" v-if="input.evaluation">{{ labels['evaluation_'+input.evaluation] }}</span>
			</div>
			<p v-if="input.display_input_info != false">{{ input.info || consistentPuncuation(getInput(inp_key).info) }}</p>
			<HelpText :class="{select_description: input.type == 'select'}" v-if="input.text" :text="input.text"></HelpText>
		</div>
	</section>
</template>

<script>
import {
	Brackets,
	WholeWord,
	CheckSquare,
	Menu,
	Gauge,
	Palette,
	Zap

} from 'lucide-vue'
import Data from '../../input_structure'

export default {
	name: 'help-input-list',
	components: {
		Brackets,
		WholeWord,
		CheckSquare,
		Menu,
		Gauge,
		Palette,
		Zap
	},
	props: {
		inputs: Object,
		category_key: String,
		page_key: String,
	},
	data: () => ({
		labels: {
			text: '文本',
			number: '数字',
			molang: 'Molang',
			toggle: '开关',

			emitter: '每个发射器',
			particle: '每个粒子',
			curve: '每条曲线',
			spawned_emitter: '生成发射器上下文',

			evaluation_once: '计算一次',
			evaluation_per_tick: '每个 Tick 计算',
			evaluation_per_loop: '每次循环计算',
			evaluation_per_use: '每次使用时计算',
			evaluation_per_render: '每次渲染时计算',
			evaluation_per_particle: '生成粒子时计算',
		},
		input_context_color: {
			emitter: '#e98989',
			particle: '#f9da88',
			spawned_emitter: '#db57ae'
		}
	}),
	methods: {
		getInput(input_key) {
			let input = Data[this.category_key]?.[this.page_key]?.inputs?.[input_key];
			return input ?? 0;
		},
		isInputVisible(input_key) {
			let input = this.getInput(input_key);
			if (!input) return true;
			let group = Data[this.category_key]?.[this.page_key];
			return input.isVisible(group);
		},
		consistentPuncuation(input) {
			if (!input) return '';
			if (input.endsWith('.') || input.endsWith('!')) return input;
			return input + '.';
		}
	}
}
</script>

<style scoped>
	/*.input_help:not(.visible) {
		opacity: 0.8;
	}*/
	h2 > svg {
		height: 22px;
		margin-top: -5px;
		background-color: var(--color-bar);
		border: 1px solid var(--color-dark);
		border-radius: 3px;
	}
	.input_info_bar {
		background-color: var(--color-dark);
		height: 24px;
		border-radius: 4px;
		margin-bottom: 3px;
	}
	.input_type_label {
		padding: 1px 8px;
		height: 100%;
		display: inline-block;
		border-radius: 4px;
		color: var(--color-border);
		background-color: var(--color-accent);
	}
	.input_context_label {
		padding: 1px 8px;
		height: 100%;
		display: inline-block;
		border-radius: 4px;
		color: var(--color-border);
		background-color: var(--color-text);
	}
	.select_description {
		padding-left: 30px;
	}
</style>
