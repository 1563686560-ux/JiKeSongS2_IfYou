import { describe, expect, it } from 'vitest';
import spec from '../../content/art.spec.json';
import { config } from '../../content';
import { deliveredAssetIds } from '../../content/assets';

/**
 * 场景接线（时相场景）。
 *
 * 这一组断言是为了防"画面对不上剧情"这类回归 —— 引擎不会因为 sceneId 指错而报错，
 * 它只会安安静静地画错一张图。已经出现过一次的是"台词写着深夜、画面却是白天"：
 * 卧室与教室一天里各有三套时相，而时刻只要漏标一个 sceneId 就会退回基底场景。
 */

const SCENES = config.scenes;
const delivered = new Set(deliveredAssetIds);
const images = config.assets.images;

const sceneOf = (momentId: string) => {
  const m = config.moments![momentId];
  expect(m, `没有时刻 ${momentId}`).toBeTruthy();
  return { moment: m, scene: SCENES[m.sceneId] };
};

describe('时相场景接线', () => {
  it('每个时刻指向的场景都存在（sceneId 写错时引擎只会画错图，不会报错）', () => {
    for (const m of Object.values(config.moments!)) {
      expect(SCENES[m.sceneId], `${m.id} 指向了不存在的场景 ${m.sceneId}`).toBeTruthy();
    }
  });

  it('每个场景的背景与叠加层都是已登记的 AssetId', () => {
    for (const s of Object.values(SCENES)) {
      if (s.background) expect(images[s.background], `${s.id} 的背景 ${s.background} 没登记`).toBeTruthy();
      for (const o of s.overlays ?? []) {
        expect(images[o], `${s.id} 的叠加层 ${o} 没登记`).toBeTruthy();
      }
    }
  });

  it('每个场景的图片都用了正式交付图，不是占位图', () => {
    // 结局场景（endingSunny / endingRain）以前用的是 ending.card，那时美工还没交 ——
    // D7 交了「结局页_七朵云背景」之后这个例外就去掉了：**现在一个场景都不许走占位图**。
    const ids = new Set<string>();
    for (const s of Object.values(SCENES)) {
      if (s.background) ids.add(s.background);
      for (const o of s.overlays ?? []) ids.add(o);
    }
    expect(ids.size, '一个地点场景都没接上？').toBeGreaterThan(0);
    for (const id of ids) {
      expect(delivered.has(id), `${id} 还在用占位图（art/ 里没有对应文件）`).toBe(true);
      expect(images[id].placeholder, `${id} 被标成了占位图`).not.toBe(true);
      expect(images[id].src, `${id} 没有 src`).toBeTruthy();
    }
  });

  it('placeholder 标记与 art/ 里实际有没有图完全对得上（回退链靠它，错了就会静默走占位图）', () => {
    for (const [id, img] of Object.entries(images)) {
      expect(img.placeholder === true, `${id}：placeholder 标记与 art/ 的实际交付不一致`).toBe(!delivered.has(id));
    }
  });

  it('背景是有损压缩图（JPEG/WebP），叠加层是带 alpha 的 PNG', () => {
    // 背景不需要透明通道，所以按有损格式交（同一画面体积差一个数量级）；
    // 叠加层**必须**带 alpha，交给 JPEG 会直接把整屏压掉。
    // kind 由交付文件的扩展名决定（不嗅 data URL 前缀 —— Vitest 里拿到的是路径不是 data URL）。
    expect(images['map.classroom.background'].kind, '背景图应当是 JPEG').toBe('jpeg');
    expect(images['overlay.classroom.night'].kind, '叠加层必须是带 alpha 的 PNG').toBe('png');
    expect(images['overlay.rain'].kind, '雨幕必须是带 alpha 的 PNG').toBe('png');
    // 地点背景一个都不能是 PNG：一批 1672×941 的 PNG 是 1.7–2.5 MB/张，早就超了单文件 1.2 MB 上限。
    // WebP 也算合格 —— 它比 JPEG 更小，而这条规则真正要拦的是"把生成器的原始 PNG 直接丢进来"。
    // 从 D2 起交付的都是 WebP（scripts/import-story-art.py 转的，同一张 1368×768 从 236KB 压到 87KB）。
    for (const id of Object.keys(images).filter((x) => x.startsWith('map.'))) {
      expect(['jpeg', 'webp'].includes(images[id].kind), `${id} 应当按 JPEG/WebP 交（PNG 会超体积上限），实际 ${images[id].kind}`).toBe(true);
    }
  });
});

describe('D1 九个时刻都接上了时相（美工 A 首批环境交付覆盖的就是 D1）', () => {
  // 逐个写死期望值，而不是"只要有 sceneId 就算过"：
  // 这里的重点是**哪个时刻进哪个时相**，写成集合断言的话把清晨的教室和晚自习的教室调换也能通过。
  const EXPECT: Record<string, string> = {
    D1_0620: 'bedroomMorning',   // 06:20 黎明
    D1_0740: 'classroomMorning', // 07:40 早读
    D1_0810: 'classroomMorning', // 08:10 被当众批评（白天，在教室里）
    D1_1020: 'classroomMorning', // 10:20 第二节课
    D1_1230: 'classroomMorning', // 12:30 午休
    D1_1530: 'playgroundRunning',// 15:30 跑操（不下雨）
    D1_2140: 'classroomNight',   // 21:40 晚自习
    D1_2230: 'classroomNight',   // 22:30 晚自习后段
    D1_2320: 'bedroomLightsOut', // 23:20 睡眠不足（已熄灯）
  };

  it('D1 的九个时刻一个不漏，而且各自进对了时相', () => {
    const d1 = Object.values(config.moments!).filter((m) => m.day === 1);
    expect(d1.map((m) => m.id).sort()).toEqual(Object.keys(EXPECT).sort());
    for (const [id, sceneId] of Object.entries(EXPECT)) {
      expect(sceneOf(id).moment.sceneId, `${id} 的时相错了`).toBe(sceneId);
    }
  });

  it('D1 没有时刻退回基底场景（退回就等于时相漏接了）', () => {
    const base = new Set(['bedroom', 'classroom', 'playground']);
    for (const m of Object.values(config.moments!).filter((x) => x.day === 1)) {
      expect(base.has(m.sceneId), `${m.id} 还在用基底场景 ${m.sceneId}`).toBe(false);
    }
  });

  it('时相和地点必须一致（卧室的时刻不能跑进教室的场景里）', () => {
    for (const m of Object.values(config.moments!)) {
      const scene = SCENES[m.sceneId];
      const nameOf: Record<string, string> = { bedroom: '卧室', classroom: '教室', playground: '操场' };
      expect(scene.name, `${m.id} 的地点是 ${m.locationId}，场景却是「${scene.name}」`).toBe(nameOf[m.locationId]);
    }
  });

  it('教室的两个时相共用同一张底图，只差一层光', () => {
    // 底图只有一张，教室的陈设才不会因为换了时段就对不上。
    expect(SCENES.classroomMorning.background).toBe(SCENES.classroomNight.background);
    expect(SCENES.classroomMorning.overlays).toEqual(['overlay.classroom.morning']);
    expect(SCENES.classroomNight.overlays).toEqual(['overlay.classroom.night']);
  });

  it('跑操的操场不带雨幕，theme 也不是 rain（theme=rain 会拉起雨声）', () => {
    expect(SCENES.playgroundRunning.overlays ?? []).toEqual([]);
    expect(SCENES.playgroundRunning.theme).not.toBe('rain');
    // 反过来：脚本里明确"考后冒雨"的那天必须还带着雨幕
    expect(SCENES.playground.overlays).toEqual(['overlay.rain']);
    expect(SCENES.playground.theme).toBe('rain');
  });

  it('「睡眠不足」事件发生在熄灯的卧室里（Zzz 信号 + 熄灯画面才是同一件事）', () => {
    for (const id of ['D1_2320', 'D2_2330', 'D3_2340', 'D4_2350', 'D5_2300', 'D6_2359']) {
      const m = config.moments![id];
      expect(m.event?.signal.kind, `${id} 不是睡眠事件`).toBe('sleepZzz');
      expect(m.locationId, `${id} 应当发生在卧室`).toBe('bedroom');
    }
    expect(sceneOf('D1_2320').scene.id).toBe('bedroomLightsOut');
  });
});

describe('D4–D7 的环境画面接线（每天交来的空镜该落在哪一刻）', () => {
  // 和 D1 一样逐个写死：这里的重点是**哪个时刻进哪个场景**。
  // 写成"只要有 sceneId 就算过"的话，把黄昏的教室和下午的教室调换也能通过。
  const EXPECT: Record<string, string> = {
    D4_0610: 'bedroomMorning',     // 06:10 卧室黎明
    D4_0930: 'classroomMorning',   // 09:30 上午的教室（交付包没有上午的空镜，走 D1 的清晨光）
    D4_1400: 'classroomFoggy',     // 14:00「下午隔着雾」空镜
    D4_1700: 'classroomDusk',      // 17:00「黄昏粉笔灰」空镜
    D4_2000: 'classroomNight',     // 20:00 家长来电（晚自习的教室）
    D4_2350: 'bedroomLightsOut',   // 23:50 睡眠不足（熄灯）
    D5_0740: 'classroomEarlyLight',// 07:40「天亮得早一点」空镜
    D5_1000: 'classroom',          // 10:00 同桌推笔记：交付的清晨/黄昏空镜都对不上 10:00 的天光
    D5_1300: 'classroom',          // 13:00 冰汽水
    D5_1630: 'playgroundGentle',   // 16:30「温柔的风」空镜（不带雨）
    D5_2100: 'classroomNight',     // 21:00 羁绊检查点（达标）
    D5_2101: 'classroomNight',     // 21:00 羁绊检查点（没达标）
    D5_2300: 'bedroomLightsOut',   // 23:00 睡眠不足
    D6_0730: 'classroomMakeup',    // 07:30「补课清晨」空镜
    D6_0830: 'classroomMakeup',    // 08:30 监考压力：同一个上午、同一间教室
    D6_1200: 'classroom',          // 12:00 饭有点凉：那张图是 4:3，做底图会被裁，走插画卡
    D6_1500: 'playgroundRainRun',  // 15:00「考后冒雨」空镜（雨画在图里）
    D6_2030: 'classroomNight',     // 20:30 排名公布
    D6_2359: 'bedroomLightsOut',   // 23:59 最后一夜
    D7_0750: 'playgroundBlueSky',  // 07:50「今天的天好蓝」空镜
    D7_1030: 'classroomPenSound',  // 10:30「笔尖沙沙」空镜
    D7_1500: 'classroomFinale',    // 15:00 终章：抬头背景 + 按性别的抬头立绘
  };

  it('D4–D7 的每个时刻都进对了场景', () => {
    for (const [id, sceneId] of Object.entries(EXPECT)) {
      expect(sceneOf(id).moment.sceneId, `${id} 的场景错了`).toBe(sceneId);
    }
  });

  it('D4–D7 一天里换一个时段就换一张底图（这几张是各自独立的空镜，不是同一张加光）', () => {
    // 教室在 D4 一天里进来了三种画面，它们必须是三张不同的底图 —— 否则"下午隔着雾"跟"黄昏"会看不出区别
    const ids = ['classroomFoggy', 'classroomDusk', 'classroomEarlyLight', 'classroomMakeup', 'classroomPenSound', 'classroomFinale']
      .map((s) => SCENES[s].background);
    expect(new Set(ids).size, '有两天共用了同一张教室空镜（那两天的画面就分不出来了）').toBe(ids.length);
    for (const id of ids) expect(delivered.has(id!), `${id} 还是占位图`).toBe(true);
  });

  it('D6 15:00 的"冒雨 / 提前放晴"是两张底图，靠 art.successScene 切，而不是叠一层雨', () => {
    expect(SCENES.playgroundRainRun.background).toBe('map.playground.rainRun');
    expect(SCENES.playgroundClearing.background).toBe('map.playground.clearing');
    // 雨是画在"冒雨"那张图里的，再叠 overlay.rain 就是两层雨
    expect(SCENES.playgroundRainRun.overlays ?? [], '冒雨场景不该再叠一层雨幕').toEqual([]);
    expect(SCENES.playgroundClearing.overlays ?? [], '放晴场景不该有雨幕').toEqual([]);
    // 兜底用的基底操场仍然保留下雨的那一套（脚本里"在操场上明确下雨"的基底）
    expect(SCENES.playground.overlays).toEqual(['overlay.rain']);
  });

  it('玩家在场上，所以每个地点场景都要有体态；终章/黄昏这类要"抬头"的不能漏', () => {
    for (const s of Object.values(SCENES).filter((x) => !x.id.startsWith('ending') && x.id !== 'memoryEcho')) {
      expect(s.character?.pose, `${s.id} 没有体态`).toBeTruthy();
    }
    expect(SCENES.classroomDusk.character?.pose).toBe('lookUp');
    expect(SCENES.classroomFinale.character?.pose).toBe('lookUp');
    expect(SCENES.classroomFoggy.character?.pose).toBe('stare');
  });
});

describe('终章与结局页的背景（D7 交付）', () => {
  it('结局页背景不再走占位图：ending.card 已经换成 D7 的「七朵云背景」', () => {
    expect(delivered.has('ending.card'), 'ending.card 还是占位图').toBe(true);
    expect(images['ending.card'].placeholder).not.toBe(true);
    expect(SCENES.endingSunny.background).toBe('ending.card');
    expect(SCENES.endingRain.background).toBe('ending.card');
    expect(spec.assets['ending.card' as keyof typeof spec.assets].width).toBe(1280);
  });

  it('记忆回响的黑屏背景已接上，而且它不是"地点"（不该被当成第四个地点）', () => {
    expect(delivered.has('ending.memoryEcho'), '记忆回响背景还是占位图').toBe(true);
    expect(SCENES.memoryEcho.background).toBe('ending.memoryEcho');
    expect(['卧室', '教室', '操场']).not.toContain(SCENES.memoryEcho.name);
    // 没有时刻会"住在"记忆回响里：它是结局流程中间切一下的一段，不进 moments
    for (const m of Object.values(config.moments!)) expect(m.sceneId).not.toBe('memoryEcho');
  });

  it('四个结局的背景都是同一张交付图，且和 config.scenes 里登记的结局场景不打架', () => {
    for (const e of config.endings) {
      expect(e.scene.background, `${e.id} 的结局场景没有底图（scene.show() 拿到自带的 SceneConfig，不会去查 config.scenes）`).toBe('ending.card');
      // 结局自带的 scene 与 config.scenes 里同名的那一份必须指向同一张底图，否则
      // "验收看的是一张、玩家看的是另一张"这种错会一直藏着
      expect(e.scene.background).toBe(SCENES[e.scene.id].background);
      expect(SCENES[e.scene.id], `${e.id} 指向了没登记的结局场景 ${e.scene.id}`).toBeTruthy();
    }
    expect(config.endings.every((e) => delivered.has(e.scene.background!))).toBe(true);
  });
});

describe('地图坐标基准不许和美术规格各说各话', () => {  it('MapConfig 的 baseWidth/baseHeight 就是该地点背景图的交付尺寸', () => {
    const assets = (spec as { assets: Record<string, { width: number; height: number }> }).assets;
    for (const map of Object.values(config.maps)) {
      const want = assets[map.background!];
      expect(map.baseWidth, `${map.id} 的坐标基准宽度和 ${map.background} 的交付尺寸不一致`).toBe(want.width);
      expect(map.baseHeight, `${map.id} 的坐标基准高度和 ${map.background} 的交付尺寸不一致`).toBe(want.height);
      for (const loc of map.locations) {
        expect(loc.hit.x + loc.hit.w, `${map.id}/${loc.id} 的热区超出了坐标基准宽度`).toBeLessThanOrEqual(want.width);
        expect(loc.hit.y + loc.hit.h, `${map.id}/${loc.id} 的热区超出了坐标基准高度`).toBeLessThanOrEqual(want.height);
      }
    }
  });
});
