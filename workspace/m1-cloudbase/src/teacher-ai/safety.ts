/** Safety checks that apply both when a trial suggestion is saved and when it is adopted. */
export function safeTeacherSuggestionText(value: string): boolean {
  const text = value.trim();
  return text.length >= 50 && text.length <= 150
    && !/[\u0000-\u001f]/u.test(text)
    && !/1[3-9]\d{9}/u.test(text)
    && !/(?:事实\s*ID|fact\s*id|task_items|item_\d+|citedFactIds|submissionId|promptVersion|modelVersion)/iu.test(text)
    && !/[一-龥]\s+[一-龥]/u.test(text)
    && !text.includes('教师可结合本次作答再核对细节，选择适合的练习方式')
    && /(?:你可以|试着|不妨|请你|可以先|先把|先找|再把|再读|再看|再想|检查|对照|说说|读一读|写一写|练一练|改一改|复习|练习|解释|朗读|听读|回放|辨认|区分|比较|圈出|划出|标出|找出|写出|读出|说出|抄写|拼写|跟读|听一听|看一看|再写|再练|再试|复述|选择|观察|回顾|排序|配对)/u.test(text)
    && !/(?:教师可|建议教师|建议老师|教师可以|请教师|学生整体|整体成绩|历史成绩|继续努力)/u.test(text)
    && !/第\s*[项题]/u.test(text)
    && !/第\s*[一二三四五六七八九十]+\s*[项题]/u.test(text)
    && !/(?:通过考核|表现良好|准确无误|全部正确|全对|均已完成|全部完成|已达标|优秀|高分|满分|无错误与正确|没有错误与正确|采取核对作答动作|准确性与完整性|仅表明完成提交要求)/u.test(text);
}
