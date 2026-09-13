import type { ArtSlot, DialogueLine, MomentArt, MomentConfig, Interaction, PresentationLevel, Signal } from '../src/types/content';
import { SIGNAL_ART } from './assets';
import { bondCheckpointMet, bondCheckpointMissed, sleepShort } from './rules';
import { C, S } from './storyArt';

/**
 * 造一个已经把**信号图**接好的 Signal。
 *
 * 从前这里只写 `kind`，引擎里那张 `kind → emoji` 的表负责把它变成一个字符（🌧💤📱…），
 * 于是画面上是一颗 emoji。现在 `kind` 只是语义标签，真正的图由 `SIGNAL_ART`（content/assets.ts，
 * 全作美术 id 的登记处）给出，写进 `Signal.asset`。**取图这件事因此在内容层闭环**：
 * 引擎不认识 kind，只认 AssetId。
 *
 * 注意 `signal()` 是唯一的构造口 —— 不要在别处手写 `{ kind: ... }`，否则会漏掉 asset，
 * 那一刻的信号就静默不画（`CloudSystem` 对没有 asset 的信号直接收层）。
 */
const signal = (kind: Signal['kind'], intensity: 1 | 2 | 3 = 2): Signal => ({ kind, asset: SIGNAL_ART[kind], intensity });

// ── 数值缩放（心情）──────────────────────────────────────────────
// 下面每个时刻/干预写的都是《剧情脚本 V1.3》给出的原始设计值（+12 / +10 / −8 …）。
// 实测（tests/unit/balance.test.ts，已修正过口径）显示：按原始值，任何"能干预就干预"的玩法
// 周终心情都会顶到 98，而脚本自己的《目标心情》表（D1…D7 = 45/40/55/35/50/28/70）峰值只有 70。
// 所以统一按 MOOD_SCALE 缩放一次：**保持脚本设计的相对强弱、排序与正负号不变**，
// 只把周净变化拉回脚本意图的量级（峰值 98 → 91）。
// 要恢复脚本原始数值，把 MOOD_SCALE 改成 1 即可，其余不用动。
//
// 原始值 → 缩放后：+12→+6  +10→+5  +8→+4  +6→+3  +5→+3  +3→+2  +1→+1
//                  −12→−6  −10→−5  −9→−5  −8→−4  −6→−3  −5→−3  −2→−1  −1→−1
//
// 注意：这一层缩放**不能**让周终心情正好落到 70，因为脚本自身的两处数值互相矛盾：
// 它给的成功干预（均值约 +10）比 miss（均值约 −8）更重，而它给的守护之光又允许一周成功干预 12 次、
// 强制 miss 只有 5 次，算下来净 +80，无论怎么等比缩放都变不成它《目标心情》表隐含的 +25。
// 这个矛盾需要编剧/策划定夺（见开发文档 §13.1）。结局阈值已按实测可达区间重新标定。
const MOOD_SCALE = 0.5;
const mood = (v: number): number => (v === 0 ? 0 : Math.sign(v) * Math.max(1, Math.round(Math.abs(v) * MOOD_SCALE)));

// `tone` = 脚本给这句标的语气色（云朵（灰/白/金）里的那个颜色）。
// 它现在只决定底部对白框左边那条竖线的颜色 —— 云朵容器已经删掉，文字一律进底部对白框。
const line = (text: string, tone: 'dark'|'white'|'gold' = 'dark', id?: string, collectible = false): DialogueLine => ({ text, tone, id, collectible });
const simple = (id: string, day: number, time: string, locationId: 'bedroom'|'classroom'|'playground', title: string, text: string, moodDelta: number, next: string, tone: 'dark'|'white'|'gold' = 'dark', collectible = false, presentation: PresentationLevel = 'L0'): MomentConfig => ({ id, onceKey: id, day, time, locationId, presentation, title, sceneId: locationId, lines: [line(text, tone, collectible ? id : undefined, collectible)], outcome: { moodDelta: mood(moodDelta) }, next });
const event = (id: string, day: number, time: string, locationId: 'bedroom'|'classroom'|'playground', title: string, intro: DialogueLine[], interactions: Interaction[], miss: DialogueLine, missMood: number, next: string, timeoutSec = 10, presentation: PresentationLevel = 'L2'): MomentConfig => ({ id, onceKey: id, day, time, locationId, presentation, title, sceneId: locationId, event: { signal: signal(locationId === 'bedroom' ? 'sleepZzz' : 'darkCloud'), intro, interactions, timeoutSec, onTimeout: { moodDelta: mood(missMood), feedback: [miss] } }, next });
// 收藏句 id 用「原始值」而不是缩放值，保证图鉴 id 稳定、老存档里的已收集记录不失效
const action = (id: string, label: string, moodDelta: number, text: string, animation?: string): Interaction => ({ id, label, cost: 1, outcome: { moodDelta: mood(moodDelta), bondDelta: 1, feedback: [line(text, 'white', `${id}-${moodDelta}`, true)], effect: animation ? [{ kind: 'anim', target: 'scene', name: animation }] : undefined } });

// 「睡眠不足」专用包装：脚本《睡眠规则》要求"睡眠 < 7.25 小时才触发"（见 content/rules.ts）。
// 条件不满足时引擎会直接跳到 next，所以作息的定制结果真的会改变这一周发生什么。
// 命名上刻意与 event 分开：将来若新增非睡眠类的卧室事件，不会被误加这道门控。
const sleepEvent = (...args: Parameters<typeof event>): MomentConfig => ({ ...event(...args), when: sleepShort });

// 「手机来电」专用包装：脚本 §5.2 要求 D4 爸妈来电有"手机震动"表现，
// 所以信号要换成 phoneWave（引擎会据此播手机震动音 + 震动画），而不是默认的雨云。
const phoneEvent = (...args: Parameters<typeof event>): MomentConfig => {
  const m = event(...args);
  return { ...m, event: { ...m.event!, signal: signal('phoneWave') } };
};

// 「老师出场」专用包装：给 L1 底部对白框的右侧槽位点上老师立绘。
// 只用在**本来就是 L1** 的时刻上（拖堂说教 / 再次被批评）——老师是这两刻的当事人，
// 台词却是主角的，所以老师会以"在场但非当前说话者"的暗态出现，正好符合 §5.1 的说话者高亮规则。
// 老师素材男女路线共用（交付说明 §一.4），不按性别复制两套。
const teacherEvent = (pose: 'normal' | 'strict', ...args: Parameters<typeof event>): MomentConfig =>
  ({ ...event(...args), npcPose: pose });

// 「D1 剧情插画」包装：按《人物素材使用说明 三、DAY1 推荐使用流程》逐条挂图。
// 图用**语义姿态**引用（pose），由引擎按开局性别解析成 art.d1.<boy|girl>.<pose> ——
// 从类型上就不可能把男女主角的素材混进同一条剧情画面（交付说明 §一.2）。
// 老师不分性别，用 { id } 直接指定。
const ART = {
  calm: { pose: 'calm' },
  tired: { pose: 'tired' },
  tense: { pose: 'tense' },
  relax: { pose: 'relax' },
  down: { pose: 'down' },
  sit: { pose: 'sit' },
  sitRelax: { pose: 'sitRelax' },
  strain: { pose: 'strain' },
  teacherStrict: { id: 'portrait.teacher.strict' },
} as const satisfies Record<string, ArtSlot>;

/**
 * 给**任意**时刻挂剧情图编排（simple / event / sleepEvent / teacherEvent 都能用）。
 *
 * 早先这个包装只收 simple 的位置参数，于是事件类时刻（D2 的成绩单、D3 的午饭……）
 * 全都挂不上图 —— 而它们恰恰是最需要画面的时刻。改成"先构造时刻、再挂图"，
 * 挂图这件事就和时刻是怎么造出来的无关了。
 */
const withArt = (art: MomentArt, m: MomentConfig): MomentConfig => ({ ...m, art });

/**
 * 时相接线：把已经构造好的时刻挂到某个**场景变体**上（见 content/scenes.ts）。
 *
 * 时刻只声明"我在哪个地点的哪个时相里"，具体用哪张底图、叠哪层光由场景决定 ——
 * 这样换图不必动剧情，也不会出现"台词写着深夜、画面却是白天"这种对不上的情况。
 * 做成外层包装而不是给 `simple()` 再加一个位置参数，是因为它已经有 12 个位置参数了。
 */
const at = (sceneId: string, m: MomentConfig): MomentConfig => ({ ...m, sceneId });

export const moments: Record<string, MomentConfig> = {};
const add = (m: MomentConfig) => { moments[m.id] = m; };

// ── D1：九个时刻全部接上时相场景 ──────────────────────────────────
// 美工 A《环境与移动》首批交付覆盖的正好是 D1 用到的三处环境，所以先把 D1 接满：
//   06:20 黎明 = 清晨的卧室 ｜ 07:40–12:30 = 清晨光下的教室 ｜ 15:30 跑操 = **不带雨**的操场
//   21:40–22:30 = 夜间光下的教室 ｜ 23:20「睡眠不足」= 熄了灯的卧室
// 其它日期仍走基底场景（同样的底图，只是不带时相光），要接时相就是给那一刻加一个 at()。
add(at('bedroomMorning', withArt({ cg: [ART.tired] }, simple('D1_0620',1,'06:20','bedroom','黎明','……再睡五分钟，就好了。',-2,'D1_0740'))));
add(at('classroomMorning', withArt({ cg: [ART.calm] }, simple('D1_0740',1,'07:40','classroom','早读','早读。窗外的鸟，叫得很自由。',0,'D1_0810'))));
// 被当众批评：交付说明给的是"主角正常坐姿 → 老师严肃批评 → 紧绷动作 → 低头 → 干预 → 放松"这条画面顺序，
// 落到引擎的三个阶段上就是：入场坐姿 / 干预窗口（紧绷 + 老师并排）/ 收尾（成功放松、miss 低头）。
add(at('classroomMorning', {
  ...event('D1_0810',1,'08:10','classroom','被当众批评',[line('今天的话，好像有点太多了。')],[action('coverEars','捂耳朵',12,'世界安静了一秒，刚刚好。','handCoverEars'),action('zipMouth','关嘴巴',10,'今天的话，好像变少了。','zipMouth')],line('……又被说了。'),-10,'D1_1020'),
  art: {
    cg: [ART.sit],
    during: [ART.strain, ART.teacherStrict],
    success: [ART.sitRelax],
    miss: [ART.down],
  },
}));
add(at('classroomMorning', withArt({ cg: [ART.sit] }, simple('D1_1020',1,'10:20','classroom','第二节课','眼皮，好重。老师的板书，越来越远。',0,'D1_1230'))));
add(at('classroomMorning', withArt({ cg: [ART.tired] }, simple('D1_1230',1,'12:30','classroom','午休','趴十分钟……就十分钟。',1,'D1_1530'))));
add(at('playgroundRunning', withArt({ cg: [ART.calm] }, simple('D1_1530',1,'15:30','playground','跑操','跑操好累。注意排面。',0,'D1_2140'))));
add(at('classroomNight', withArt({ cg: [ART.sit] }, simple('D1_2140',1,'21:40','classroom','晚自习','台灯下，影子小小的。',0,'D1_2230'))));
add(at('classroomNight', withArt({ cg: [ART.tired] }, simple('D1_2230',1,'22:30','classroom','晚自习后段','好想写点什么发泄。算了，不写了，还要复习。',-1,'D1_2320'))));
add(at('bedroomLightsOut', { ...sleepEvent('D1_2320',1,'23:20','bedroom','睡眠不足',[line('闹钟，又要响了。')],[action('extraSleep','偷加两小时',6,'今晚，时间走得慢了一点。','clockRewind')],line('闹钟，又要响了。'),-6,'D2_0620'), art: { cg: [ART.tired], during: [ART.tired], success: [ART.relax] } }));
// ── D2：八个时刻接上画 ─────────────────────────────────────────────
// 画面顺序来自《如果有你_DAY2 人物素材使用说明》：成绩单（08:00）、拖堂说教（10:20）、
// 食堂（12:40）、体育课改自习（16:00）、焦虑（22:50）、睡眠不足（23:30）。
// 复用的部分**不重复导入**：说明里"DAY1 精选"的紧绷/疲惫/坐姿就是 art/ 里已有的 art.d1.<who>.*，
// 剧情里照旧写 ART.tense / ART.tired / ART.sit，引擎按开局性别取图。
add(at('bedroomMorning', withArt({ cg: [S('bunkSleep')] },
  simple('D2_0620',2,'06:20','bedroom','赖床','昨晚的题，梦见自己还在写。',-1,'D2_0800'))));

// 成绩单来了：左=主角在看成绩单，右=老师递出成绩单（和 D1「被批评」同一套"1 张居中 / 2 张并排"编排）；
// 干预窗口期间换成"同学聚拢围观"的事件画面。成功/miss 都不换图 —— 这一刻的重点是那份成绩单，
// 不是主角的表情，换图反而会让人以为发生了别的事。
//
// 围观那张是 **C()**（who:'common'，画面里没有男女主角，两条路线共用），
// 早先这里误写成了 S('crowd') —— S 会按开局性别拼成 art.story.boy.crowd，那是个不存在的
// AssetId，于是"成绩单来了"的干预窗口与收尾全程没有人物图（场景里只剩场景底图）。
// 现在 S()/C() 各自都会拒绝用错的入口（见 content/storyArt.ts），这类错是加载期抛错而不是静默白屏。
add(at('classroomMorning', withArt({
  cg: [S('report'), C('handout')],
  during: [C('crowd')],
}, event('D2_0800',2,'08:00','classroom','成绩单来了',[line('班主任把成绩单送来了。')],[action('candy','塞糖',10,'糖？谁放的……真甜。','candyDrop'),action('whisper','悄悄话',10,'宝贝，没关系的。人生不会因为一次考试就完蛋。')],line('……下次，会进步的。'),-8,'D2_1020'))));

// 拖堂说教：交付说明指定「紧绷状态」，老师素材男女路线共用（§一.4）。
add(at('classroomMorning', withArt({ cg: [ART.tense, ART.teacherStrict] },
  teacherEvent('strict','D2_1020',2,'10:20','classroom','拖堂说教',[line('下课铃响了。')],[action('zipMouth','关嘴巴',10,'下课铃，终于赢了老师一次。','zipMouth')],line('下课铃响了。老师没听见。'),-6,'D2_1240',10,'L1'))));

add(at('classroomMorning', withArt({ cg: [S('canteen')] },
  simple('D2_1240',2,'12:40','classroom','午休','今天的菜里，有我爱吃的。',2,'D2_1600','white',true))));

// 16:00 走基底教室，不接 classroomMorning 的光 —— 那是清晨光，套在下午四点的画面上会不对。
add(withArt({ cg: [ART.tired] },
  simple('D2_1600',2,'16:00','classroom','体育课改自习','好不容易的放松时间，又没了。',-10,'D2_2250','dark',false,'L1')));

// 焦虑：说明书写"紧绷状态用于 22:50 焦虑表现"，干预成功换成放松态（和 D1 的收尾一致）。
add(at('bedroomNight', withArt({ cg: [ART.tense], success: [ART.relax] },
  event('D2_2250',2,'22:50','bedroom','焦虑',[line('这次退步了。我要更努力，好好学习。')],[action('whisperGoodnight','祝你好梦',3,'……好像，真的安心了一点。'),action('whisperPraise','你已经做得很棒了。',3,'……好像，真的安心了一点。')],line('道理，都懂的。可是……'),-3,'D2_2330',10,'L1'))));

add(at('bedroomLightsOut', withArt({ cg: [S('bunkSleep')] },
  sleepEvent('D2_2330',2,'23:30','bedroom','睡眠不足',[line('闹钟，又要响了。')],[action('extraSleep','偷加两小时',6,'今晚，时间走得慢了一点。','clockRewind')],line('闹钟，又要响了。'),-7,'D3_0750'))));

// ── D3：六个时刻 ───────────────────────────────────────────────────
add(at('classroomMorning', withArt({ cg: [S('morningRead')] },
  simple('D3_0750',3,'07:50','classroom','晨读','晨读的声音，混着豆浆的热气。',2,'D3_1000','white',true))));
add(at('classroomMorning', withArt({ cg: [ART.tense, ART.teacherStrict] },
  teacherEvent('strict','D3_1000',3,'10:00','classroom','再次被批评',[line('今天的话，好像有点太多了。')],[action('coverEars','捂耳朵',10,'世界安静了一秒，刚刚好。'),action('zipMouth','关嘴巴',8,'今天的话，好像变少了。')],line('这次，没上次那么难受了。……大概。'),-8,'D3_1230',10,'L1'))));
add(at('classroomMorning', withArt({ cg: [S('lunchAlone')] },
  event('D3_1230',3,'12:30','classroom','一个人的午饭',[line('今天又，没人陪我吃饭。')],[action('candy','塞糖',12,'糖？……给我的吗。','candyDrop')],line('一个人的教室，安静得刚刚好。……刚刚好。'),-9,'D3_1540',10,'L1'))));

// 15:40「风」：交付的是一张**操场空镜**（不是人物图），所以它接的是场景底图（playgroundWindy），
// 不给 CG —— 空镜本来就该铺满舞台，塞进一张卡里反而变成"照片里的照片"。
add(at('playgroundWindy', simple('D3_1540',3,'15:40','playground','风','风把云，吹得很快。',1,'D3_2130','white')));

add(at('classroomNight', withArt({ cg: [ART.sit] },
  simple('D3_2130',3,'21:30','classroom','夜','错题本，又厚了一页。',-1,'D3_2340'))));
add(at('bedroomLightsOut', withArt({ cg: [S('bunkSleep')] },
  sleepEvent('D3_2340',3,'23:40','bedroom','睡眠不足',[line('闹钟，又要响了。')],[action('extraSleep','偷加两小时',6,'今晚，时间走得慢了一点。')],line('闹钟，又要响了。'),-8,'D4_0610'))));

// ── D4：六个时刻（《如果有你_DAY4 人物素材使用说明》逐条落点）──────────
// 画面顺序来自交付说明：06:10 梦里都在考试 → 09:30 排名被当众念出 → 14:00 下午隔着雾
// → 17:00 黄昏粉笔灰 → 20:00 家长来电 → 23:50 深夜睡眠不足。
//
// 06:10 卧室清晨（D1_0620 同一时相：黎明的卧室）
add(at('bedroomMorning', withArt({ cg: [S('examDream')] },
  simple('D4_0610',4,'06:10','bedroom','清晨','梦里，都在考试。',-2,'D4_0930'))));

// 09:30 排名被当众念出：交付的是一张**人物插画**（含教室里的人），所以走 CG 卡；
// 场景仍用清晨光的教室（上午九点半）。干预窗口不换图 —— 这一刻的重点是那个名次，
// 不是主角的表情，换图反而会让人以为发生了别的事（和 D2 成绩单同一套判断）。
add(at('classroomMorning', withArt({ cg: [S('rankCalled')] },
  event('D4_0930',4,'09:30','classroom','排名被当众念出',[line('第 23 名。')],[action('coverEars','捂耳朵',12,'第 23 名。可是这一秒，它跟我无关。')],line('第 23 名。声音那么大，全班都听见了。'),-12,'D4_1400'))));

// 14:00 下午隔着雾：交付的是一张**教室空镜**（16:9），所以接成场景底图；
// 说明书写"使用对应性别的眼神放空状态叠加在本背景上"，而"眼神放空"就是 art.d1.<who>.relax
// 那一份文件（交付的 男生_眼神放空_复用.png 与 D1 的 男生_放松状态.png 是同一张，字节相同）。
// 说明书同时提到"可与正常坐姿组合"，但两张并排会变成"一个人两个姿势"，所以只取放空。
add(at('classroomFoggy', withArt({ cg: [ART.relax] },
  simple('D4_1400',4,'14:00','classroom','下午','下午的课，像隔着一层雾。',-1,'D4_1700'))));

// 17:00 黄昏粉笔灰：同样是空镜底图，接成场景（这一张的构图就是橘色的黄昏教室）。
// **这一刻本该还有一张"抬头"图**（交付说明 §四点名了 男生_抬头_复用.png / 女生_抬头_复用.png），
// 但包里没有这两个文件。按"缺图就用别的图顶上"的要求，这里用 D1 的「平静」插画代替
// （`art.d1.<who>.calm`，真透明抠图，所以是人物直接站在黄昏教室里，不是一张卡片）。
// 为什么不用 14:00 那张「放空」（relax）：那一张三个小时前刚用过，同一张脸连着出现两次更假。
// 交付说明里这张本来就叫「抬头_复用」—— 复用一张 D1 的动作图，正是它的原意。
// 补图后要改两处：art.spec.json 里给 art.story.<who>.lookUp 交文件，并把这里换成 S('lookUp')。
add(at('classroomDusk', withArt({ cg: [ART.calm] },
  simple('D4_1700',4,'17:00','classroom','黄昏','黄昏的教室，是橘色的。',3,'D4_2000','white',true))));

// 20:00 爸妈来电：手机道具（1:1 特写）接成第二张卡 —— 左边是低头的主角、右边是亮着的屏幕。
// 手机震动本身由 phoneEvent 的 phoneWave 信号负责（音 + 震动画），图只负责"来电"这件事。
add(at('classroomNight', withArt({ cg: [S('phoneBow'), C('phoneCall')] },
  phoneEvent('D4_2000',4,'20:00','classroom','爸妈来电',[line('手机在桌肚里震动。屏幕亮着：妈。')],[action('hug','抱抱TA',10,'说出来了。……原来，说出来，会轻一点。'),action('pat','拍拍TA的肩',-5,'……嗯，我没事。真的。我爱你们。')],line('电话那头问，累不累。……我说不累。'),-10,'D4_2350'))));

// 23:50 深夜睡眠不足：交付说明给了"上下铺皱眉睡觉"（复用 DAY2）和"疲惫状态"两种说法，
// 这里取上下铺 —— D2_2330 / D3_2340 用的就是它，同一个"半夜醒着"的画面不该一周里换三张脸。
add(at('bedroomLightsOut', withArt({ cg: [S('bunkSleep')], during: [S('bunkSleep')], success: [ART.relax] },
  sleepEvent('D4_2350',4,'23:50','bedroom','睡眠不足·深夜版',[line('闹钟，又要响了。')],[action('extraSleep','偷加两小时',8,'今晚，好像有人替我把夜，调暗了一点。')],line('闹钟，又要响了。'),-10,'D5_0740'))));

// ── D5：六个时刻 ───────────────────────────────────────────────────
// 07:40「天亮得早一点」是空镜（16:9），接成场景底图。
add(at('classroomEarlyLight', simple('D5_0740',5,'07:40','classroom','清晨','今天的天，好像亮得早一点。',2,'D5_1000','white',true)));

// 10:00 同桌把笔记推过来：人物插画（4:3）+ 笔记道具特写（1:1）并排 ——
// "推过来的那本笔记"才是这一刻的第二主角，所以两张一起上。
// 这一刻是 L1（底部对白带），场景走基底教室：交付的清晨/黄昏空镜都对不上 10:00 的天光。
add(withArt({ cg: [S('notesPassed'), C('notesProp')] },
  simple('D5_1000',5,'10:00','classroom','同桌','同桌把笔记推了过来，什么也没说。',8,'D5_1300','white',true,'L1')));

// 13:00 冰汽水：交付的就是一张道具特写，所以这一刻的主角就是那瓶汽水（单张 1:1 卡）。
add(withArt({ cg: [C('soda')] },
  simple('D5_1300',5,'13:00','classroom','午后','小卖部的冰汽水，咕嘟咕嘟。',3,'D5_1630','white',true)));

// 16:30 操场的风：空镜（16:9），接成场景底图 —— 不带雨幕，theme 也不是 rain。
add(at('playgroundGentle', simple('D5_1630',5,'16:30','playground','操场','操场的风，把汗吹干了。',1,'D5_2100','white')));

// 脚本第 236–239 行 D5 21:00「羁绊检查点」：羁绊 ≥ 6 走金色版，羁绊 < 6 走白色版。
// 之前只实现了"羁绊 < 6"那一版并且无条件触发，等于让整条羁绊线在这一刻失效、金句也拿不到。
// 用两个互斥 when 的时刻表达（不满足条件的那个会被引擎直接跳到 next）；时间相同以保证排序稳定。
// 两个分支共用同一张"羁绊检查点"插画：差别在台词与云色，不在画面。
add(at('classroomNight', withArt({ cg: [S('bondCheck')] },
  { ...simple('D5_2100',5,'21:00','classroom','羁绊检查点','像是有谁，一直在。',5,'D5_2101','gold',true,'L1'), when: bondCheckpointMet })));
add(at('classroomNight', withArt({ cg: [S('bondCheck')] },
  { ...simple('D5_2101',5,'21:00','classroom','羁绊检查点','……今天，也就这样吧。',0,'D5_2300','white',false,'L1'), when: bondCheckpointMissed })));

add(at('bedroomLightsOut', withArt({ cg: [S('bunkSleep')], during: [S('bunkSleep')], success: [ART.relax] },
  sleepEvent('D5_2300',5,'23:00','bedroom','睡眠不足',[line('闹钟，又要响了。')],[action('extraSleep','偷加两小时',6,'今晚，时间走得慢了一点。')],line('闹钟，又要响了。'),-8,'D6_0730'))));

// ── D6：六个时刻 ───────────────────────────────────────────────────
// 07:30 补课清晨：空镜接成场景。08:30 的监考压力在同一个上午、同一间教室，所以共用这个场景
// （中间没有换过地方，换底图反而会像换了个教室）。
add(at('classroomMakeup', simple('D6_0730',6,'07:30','classroom','月考','难得的休息日。可是，月考。',-1,'D6_0830')));
add(at('classroomMakeup', withArt({ cg: [S('invigilate')], during: [S('invigilate'), C('examPaper')] },
  event('D6_0830',6,'08:30','classroom','监考压力',[line('监考老师的脚步声。')],[action('coverEars','捂耳朵',10,'脚步声停了。世界，先安静一会儿。')],line('监考老师的脚步声。一下，一下。'),-8,'D6_1200'))));

// 12:00 饭有点凉：交付源是 4:3（别的教室空镜都是 16:9），做底图会被裁掉画面高度，
// 所以按插画卡接 —— 反正这一刻要看的就是那个冷掉的饭盒。
add(withArt({ cg: [C('coldLunch')] },
  simple('D6_1200',6,'12:00','classroom','午间','饭有点凉。快点吃完，再看会儿书。',-2,'D6_1500')));

// 15:00 考后冒雨：交付说明 §四.3 明说"雨天和放晴是两张背景，根据干预结果切换"。
// 底图（含雨）在场景上，干预成功再换成"提前放晴"那张 —— 用 art.successScene 切场景，
// 不是换插画（插画换不了整屏的天气）。clearSky 动画照旧叠一层过渡。
add(at('playgroundRainRun', withArt({ successScene: 'playgroundClearing' },
  event('D6_1500',6,'15:00','playground','考后冒雨',[line('雨还没有停。')],[action('clearSky','提前放晴',10,'考完了，天也晴了。像是个好兆头。','clearSky')],line('雨里走回去，头发湿了一半。'),-8,'D6_2030'))));

// 20:30 排名公布：人物插画接 CG 卡，场景用夜间教室。
add(at('classroomNight', withArt({ cg: [S('rankPost')] },
  event('D6_2030',6,'20:30','classroom','排名公布',[line('还是那个名次。')],[action('coverEars','捂耳朵',12,'名次什么的，明天再听。'),action('zipMouth','关嘴巴',10,'这一次，念的不是我。'),action('candy','塞糖',10,'嘴里的甜，盖过了心里的酸。')],line('还是那个名次。还是，那个名次。'),-12,'D6_2359'))));

// 23:59 最后一夜：交付专门画了这两张"最后一夜睡眠不足"（3:4），不用复用的上下铺图 ——
// 这一夜是整周的收尾，值得一张属于它自己的画面。成功（睡沉了）换放松态。
add(at('bedroomLightsOut', withArt({ cg: [S('lastNight')], success: [ART.relax] },
  sleepEvent('D6_2359',6,'23:59','bedroom','睡眠不足·最后一夜',[line('这一周，最累的一夜。')],[action('extraSleep','偷加两小时',10,'可是今晚，睡得特别沉。')],line('还剩一分钟。这一周，就结束了。'),-10,'D7_0750',15))));

// ── D7：三个时刻（终章）──────────────────────────────────────────────
add(at('playgroundBlueSky', simple('D7_0750',7,'07:50','playground','告别','今天的天，好蓝。',5,'D7_1030','white',true)));
add(at('classroomPenSound', simple('D7_1030',7,'10:30','classroom','日常','笔尖沙沙的声音，忽然很好听。',3,'D7_1500','white',true)));
// 15:00 终章（L3）：场景 = 交付的"抬头背景"（空教室 + 窗外蓝天），插画 = 按性别的"终章抬头"。
// 交付说明 §二：这两张不得同时加载 —— S() 走按开局性别解析，从类型上就做不到同时上屏。
add(at('classroomFinale', withArt({ cg: [S('finalLookUp')] },
  { id:'D7_1500', onceKey:'D7_1500', day:7, time:'15:00', locationId:'classroom', presentation:'L3', title:'终章', sceneId:'classroomFinale', lines:[line('那个……','gold','d7a',true),line('一直陪着我的，是你吗？','gold','d7b',true),line('捂住耳朵的时候，掉进抽屉的糖，拨慢的钟……','gold','d7c',true),line('感谢你，撑过来了。','gold','d7d',true)], next:'ending-pick' })));

export const momentOrder = Object.values(moments).sort((a,b) => a.day - b.day || a.time.localeCompare(b.time)).map((m) => m.id);
