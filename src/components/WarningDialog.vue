<template>
    <dialog id="warnings" class="dialog">
        <div class="tool close_button" @click="$emit('close')"><i class="unicode_icon">{{'\u2A09'}}</i></div>
        <h2>警告</h2>
        <div class="scrollable">
            共有 {{ errors.length }} 条警告：
            <ul>
                <li class="warning" v-for="(error, index) in errors" :key="index">
                    {{ error.text }}
                </li>
            </ul>
        </div>
    </dialog>
</template>

<script>

import {Config} from './../emitter'

const errors = [];

function validate() {
    errors.splice(0, errors.length);


    if (
        (Config.particle_appearance_material == 'particles_alpha' || Config.particle_appearance_material == 'particles_opaque') && (
            (Config.particle_color_mode == 'static' && Config.particle_color_static.length == 9 && Config.particle_color_static.substr(-2).toUpperCase() != 'FF') ||
            (Config.particle_color_mode == 'expression' && ['', '1', '1.0'].includes(Config.particle_color_expression[3]) == false)
        )
    ) {
        errors.push({text: `当前效果尝试使用透明度，但所选材质不支持透明度`})
    }

    if (Config.particle_appearance_facing_camera_mode.includes('direction') && Config.particle_appearance_direction_mode == 'derive_from_velocity') {
        if (Config.particle_motion_mode == 'dynamic' && !(Config.particle_motion_linear_speed && parseFloat(Config.particle_motion_linear_speed) != 0)) {
            errors.push({text: `粒子设置为朝向某个方向，但未设置速度。只有具有初始速度的粒子支持方向朝向`})

        } else if (Config.particle_motion_mode == 'parametric' && !Config.particle_motion_direction.find(v => v && parseFloat(v) != 0)) {
            errors.push({text: `粒子设置为朝向某个方向，但未设置参数化方向`})
        }
    }

    if (Config.emitter_rate_mode == 'steady' && Config.emitter_lifetime_mode !== 'expression' && !isNaN(Config.emitter_rate_rate) && 1/parseFloat(Config.emitter_rate_rate) >= parseFloat(Config.emitter_lifetime_active_time)) {
        errors.push({text: `发射器速率低于发射器生命周期，粒子可能不会生成`})
    }

    return errors;
}


export default {
    name: 'warning-dialog',
    data() {return {
        errors
    }}
}
export {validate}

</script>

<style scoped>
	.scrollable {
		overflow-y: scroll;
    }
    li.warning {
        list-style: inside;
        padding: 10px;
        color: #ffc107;
    }
</style>
