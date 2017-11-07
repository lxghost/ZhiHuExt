"use strict"


function reportSpam(id, type)
{
    const payload = { "resource_id": id, "type": type, "reason_type": "spam", "source": "web" };
    ContentBase._report("spams", { id: id, type: type });
    //req.setRequestHeader("Referer", "https://www.zhihu.com/people/" + id + "/activities");
    const pms = $.Deferred();
    ContentBase._post("https://www.zhihu.com/api/v4/reports", payload)
        .done((data, status, xhr) =>
        {
            if (xhr.status === 204 || xhr.status === 200)
                pms.resolve();
        })
        .fail((data, status, xhr) =>
        {
            if (data.responseJSON)
                pms.reject({ code: data.responseJSON.error.code, error: data.responseJSON.error.message });
            else
                pms.reject({ code: xhr.status, error: "unknown error" });
        })
    return pms;
}


let CUR_QUESTION = null;
let CUR_ANSWER = null;

function parseUser(node)
{
    const nameLink = $(".UserItem-name .UserLink-link", node).get(0);
    if (!nameLink)
        return null;
    const user = new User();
    user.id = nameLink.getAttribute("href").split("/").pop();
    user.name = nameLink.innerText;
    user.head = node.querySelector("img.UserLink-avatar").src
        .split("/").pop()
        .replace(/_[\w]*.[\w]*$/, "");
    const info = node.querySelectorAll("span.ContentItem-statusItem")
        .forEach(span =>
        {
            const txt = span.innerText;
            const num = parseInt(txt);
            if (txt.includes("回答"))
                user.anscnt = num;
            else if (txt.includes("文章"))
                user.articlecnt = num;
            else if (txt.includes("关注"))
                user.followcnt = num;
        });
    return user;
}

/**
 * @param {HTMLDivElement} node -div of ".AnswerItem"
 */
function parseAnswer(node)
{
    if (!node)
        return null;

    /**@type {{type: string, token: string, upvote_num: number, comment_num: number, parent_token: string, author_member_hash_id: string}}*/
    const ansInfo = JSON.parse(node.dataset.zaModuleInfo).card.content;
    if (ansInfo.type != "Answer")
        return null;

    const nameLink = node.querySelector("a.UserLink-link");
    /**@type {string | null}*/
    const author = nameLink ? nameLink.getAttribute("href").split("/").pop() : null;

    const answer = new Answer(ansInfo.token, ansInfo.parent_token, author, ansInfo.upvote_num);
    return answer;
}


async function addSpamVoterBtns(voterNodes)
{
    const users = [];
    const btnMap = [];
    for (let idx = 0; idx < voterNodes.length; ++idx)
    {
        const node = voterNodes[idx];
        const user = parseUser(node);
        if (!user)
            continue;
        users.push(user);

        const btn = createButton(["Btn-ReportSpam", "Button--primary"], "广告");
        btn.dataset.id = user.id;
        btn.dataset.type = "member";
        $(".ContentItem-extra", node).prepend(btn);
        btnMap.push(btn);

        const btn2 = createButton(["Btn-CheckStatus", "Button--primary"], "检测");
        btn2.dataset.id = user.id;
        $(".ContentItem-extra", node).prepend(btn2);
    }
    ContentBase._report("users", users);
    if (CUR_ANSWER)
    {
        const zans = users.map(user => new Zan(user, CUR_ANSWER));
        ContentBase._report("zans", zans);
    }
    /**@type {{banned: string[], spamed: string[]}}*/
    const result = await ContentBase.checkSpam("users", users);
    const banned = new Set(result.banned);
    const spamed = new Set(result.spamed);
    for (let idx = 0; idx < btnMap.length; ++idx)
    {
        const btn = btnMap[idx];
        const id = btn.dataset.id;
        if (banned.has(id))
            btn.style.backgroundColor = "black";
        else if (spamed.has(id))
            btn.style.backgroundColor = "cornsilk";
    }
};
const voterObserver = new MutationObserver(records =>
{
    //console.log("detect add voters", records);
    const voterNodes = Array.fromArray(
        records.filter(record => (record.type == "childList" && record.target.nodeName == "DIV"))
            .map(record => $.makeArray(record.addedNodes)))
        .filter(node => node.hasClass("List-item") && !node.hasChild(".Btn-ReportSpam"));
    //console.log("added " + voterNodes.length + " voters", voterNodes);
    addSpamVoterBtns(voterNodes);
});
function monitorVoter(voterPopup)
{
    voterObserver.disconnect();
    console.log("detected voter-popup", voterPopup);
    const curVoters = $(voterPopup).find(".List-item").toArray()
        .filter(node => !node.hasChild(".Btn-ReportSpam"));
    console.log("current " + curVoters.length + " voters", curVoters);
    addSpamVoterBtns(curVoters);
    voterObserver.observe($(voterPopup)[0], { "childList": true });
    const title = $(voterPopup).siblings(".Topbar").find(".Topbar-title")[0];
    if (title)
    {
        const btn1 = createButton(["Btn-CheckAllStatus", "Button--primary"], "检测全部");
        const btn2 = createButton(["Btn-AssocAns", "Button--primary"], "启发");
        title.appendChild(btn1);
        title.appendChild(btn2);
    }
}

function addSpamAnsBtns(answerNodes)
{
    const answers = [];
    const zans = [];
    answerNodes.filter(node => !node.hasChild(".Btn-ReportSpam"))
        .forEach(node =>
        {
            const answer = parseAnswer(node);
            if (!answer) return;
            answers.push(answer);
            if (ContentBase.CUR_USER)
            {
                const span = $("span.ActivityItem-metaTitle", node.parentElement)[0];
                if (span && span.innerText.startsWith("赞"))
                    zans.push(new Zan(ContentBase.CUR_USER, answer));
            }
            const ansArea = node.querySelector(".AuthorInfo");
            if (!ansArea)
                return;
            {
                const btn = createButton(["Btn-CheckSpam", "Button--primary"], "分析");
                btn.dataset.id = answer.id;
                ansArea.appendChild(btn);
            }
            {
                const btn = createButton(["Btn-ReportSpam", "Button--primary"], "广告");
                btn.dataset.id = answer.id;
                btn.dataset.type = "answer";
                ansArea.appendChild(btn);
            }
        });
    ContentBase._report("answers", answers);
    ContentBase._report("zans", zans);
    return answers;
}

function addQuickCheckBtns(feedbackNodes)
{
    feedbackNodes.filter(node => !node.hasChild(".Btn-QCheckStatus"))
        .forEach(node =>
        {
            const hrefNode = Array.from(node.children[1].querySelectorAll("a"))
                .filter(aNode => aNode.href.includes("/people/"))[0];
            if (!hrefNode)
                return;
            let uid = hrefNode.href.split("/").pop();
            const btnNode = node.children[2];
            const btn = createButton(["Btn-QCheckStatus"], "检测");
            btn.dataset.id = uid;
            btnNode.insertBefore(btn, btnNode.children[1]);
        });
}

const bodyObserver = new MutationObserver(records =>
{
    //console.log("detect add body comp", records);
    const addNodes = Array.fromArray(records
        .map(record => $.makeArray(record.addedNodes)
            .filter(node => node instanceof HTMLDivElement)
        ));
    const delNodes = Array.fromArray(records
        .map(record => $.makeArray(record.removedNodes)
            .filter(node => node instanceof HTMLDivElement)
        ));
    {
        const voterPopup = $(addNodes).find(".VoterList-content").toArray();
        if (voterPopup.length > 0)
            monitorVoter(voterPopup);
        if ($(delNodes).find(".VoterList-content").length > 0)
        {
            console.log("here removed", delNodes);
            CUR_ANSWER = null;
        }
    }
    {
        const answerNodes = $(addNodes).find(".AnswerItem").toArray();
        if (answerNodes.length > 0)
            addSpamAnsBtns(answerNodes);
    }
});
    

$("body").on("click", "button.Btn-ReportSpam", function ()
{
    const btn = $(this)[0];
    reportSpam(btn.dataset.id, btn.dataset.type)
        .done(() => btn.style.backgroundColor = "rgb(0,224,32)")
        .fail((e) =>
        {
            console.warn("report fail:" + e.code, e.error);
            if (e.code === 103001)//repeat
                btn.style.backgroundColor = "rgb(224,224,32)";
            else if (e.code === 4039)//need verify
                btn.style.backgroundColor = "rgb(32,64,192)";
            else
                btn.style.backgroundColor = "rgb(224,0,32)";
        });
});
$("body").on("click", "button.Btn-CheckSpam", async function (e)
{
    const btn = $(this)[0];
    const ansId = btn.dataset.id;
    const voters = await ContentBase.getAnsVoters(ansId, 6000, e.ctrlKey ? "old" : "new",
        (cur, all) => btn.innerText = "=>" + cur + "/" + all);

    btn.addClass("Button--blue");
    ContentBase._report("users", voters);
    const zans = voters.map(user => new Zan(user, ansId));
    ContentBase._report("zans", zans);

    const result = await ContentBase.checkSpam("users", voters);
    const total = voters.length, ban = result.banned.length, spm = result.spamed.length;
    btn.innerText = "(" + ban + "+" + spm + ")/" + total;
    if (total === 0)
        return;

    const ratio = (2 * (ban + spm) / total) - 1;
    const blue = 64 - Math.ceil(Math.abs(ratio) * 32);
    const red = ratio > 0 ? 224 : Math.ceil((ratio + 1) * 192) + 32;
    const green = ratio < 0 ? 224 : 224 - Math.ceil(ratio * 192);
    btn.style.backgroundColor = "rgb(" + red + "," + green + "," + blue + ")";
});
$("body").on("click", "button.Btn-CheckStatus", async function (e)
{
    const btn = $(this)[0];
    const uid = btn.dataset.id;
    if (e.ctrlKey)
    {
        chrome.runtime.sendMessage({ action: "openpage", target: "https://www.zhihu.com/people/" + uid + "/activities", isBackground: true });
        return;
    }
    const user = await ContentBase.checkUserState(uid);
    if (!user)
        return;
    if (user.status === "ban" || user.status === "sban")
    {
        btn.style.backgroundColor = "black";
        $(btn).siblings(".Btn-ReportSpam")[0].style.backgroundColor = "black";
    }
    else
    {
        btn.style.backgroundColor = "rgb(0,224,32)";
        $(btn).siblings(".Btn-ReportSpam")[0].style.backgroundColor = "";
    }
    ContentBase._report("users", user);
});
$("body").on("click", "button.Btn-CheckAllStatus", async function (e)
{
    const btn = $(this)[0];
    const isCtrl = e.ctrlKey;
    const voterList = btn.parentNode.parentNode.parentNode;
    const btnList = [];
    $(voterList).find(".ContentItem").each((idx, item) =>
    {
        const extraArea = item.querySelector(".ContentItem-extra");
        if (!extraArea)
            return;
        const btnChk = extraArea.children[0], btnSpam = extraArea.children[1];
        if (btnChk.style.backgroundColor != "" || btnSpam.style.backgroundColor == "black")//has result
            return;
        if (!isCtrl && btnSpam.style.backgroundColor != "")
            return;
        btnList.push({ name: btnChk.dataset.id, btn: btnChk });
    });
    console.log("detect " + btnList.length + " user");
    for (let idx = 0; idx < btnList.length; ++idx)
    {
        btn.textContent = btnList[idx].name;
        btnList[idx].btn.click();
        await _sleep(600);
    }
    btn.textContent = "检测全部";
});
$("body").on("click", "span.Voters", function ()
{
    const span = $(this)[0];
    const ansNode = $(span).parents("div.AnswerItem")[0];
    if (!ansNode)
        return;

    CUR_ANSWER = JSON.parse(ansNode.dataset.zaModuleInfo).card.content.token;
});
$("body").on("click", "button.Btn-AssocAns", function ()
{
    chrome.runtime.sendMessage({ action: "openpage", isBackground: false, target: "AssocAns.html?ansid=" + CUR_ANSWER });
});
$("body").on("click", "button.Modal-closeButton", function ()
{
    CUR_ANSWER = null;
});


function procInQuestion()
{
    console.log("question page");
    const qstPage = $(".QuestionPage")[0];
    const qstData = JSON.parse(Array.from(qstPage.childNodes)
        .filter(node => node instanceof HTMLDivElement)
        .find(div => div.className == "")
        .dataset.zopQuestion);
    const topics = qstData.topics.map(t => new Topic(t.id, t.name));
    const quest = new Question(qstData.id, qstData.title, topics.mapToProp("id"));
    CUR_QUESTION = quest;
    ContentBase._report("questions", quest);
    ContentBase._report("topics", topics);
    const qstArea = $(".QuestionHeader-footer .QuestionButtonGroup")
    if (qstArea.length > 0)
    {
        const btn = createButton(["Btn-ReportSpam", "Button--primary"], "广告");
        btn.dataset.id = CUR_QUESTION.id;
        btn.dataset.type = "question";
        qstArea.prepend(btn);
    }
}


const cmrepotObserver = new MutationObserver(records =>
{
    //console.log("detect add community report", records);
    let rows = [];
    for (let ridx = 0; ridx < records.length; ++ridx)
    {
        const record = records[ridx];
        if (record.type != "childList")
            continue;
        const nodes = record.addedNodes;
        for (let nidx = 0; nidx < nodes.length; ++nidx)
        {
            const node = nodes[nidx];
            if (node instanceof HTMLTableRowElement)
                rows.push(node);
            else
                rows = rows.concat(Array.from(node.querySelectorAll("tr")));
        }
    }
    if (rows.length === 0)
        return;
    console.log("find " + rows.length + " table-row", rows);
    const spams = [];
    const userUpds = [];
    for (let ridx = 0; ridx < rows.length; ++ridx)
    {
        const tds = Array.from(rows[ridx].childNodes)
            .filter(child => child instanceof HTMLTableCellElement);
        if (tds.length !== 5)
            continue;
        if (tds[2].innerText == "用户")
        {
            const link = tds[3].querySelector("a").href;
            const uid = link.split("/").pop();
            spams.push({ id: uid, type: "member" });
            if (tds[4].innerText.includes("已封禁"))
                userUpds.push(uid);
        }
    }
    ContentBase._report("spams", spams);
    ContentBase._update("users", "id", userUpds, { status: "ban" });
});

const pathname = document.location.pathname;
if (pathname.startsWith("/question/"))
{
    procInQuestion();
}
else if (pathname.startsWith("/community") && !pathname.includes("reported"))
{
    console.log("community report page");
    cmrepotObserver.observe($(".zu-main-content-inner")[0], { "childList": true, "subtree": true });
}

{
    const curAnswers = $(".AnswerItem").toArray();
    console.log("init " + curAnswers.length + " answers");
    addSpamAnsBtns(curAnswers);
}
$(document).ready(() =>
{
    const fbtns = document.body.querySelector(".CornerButtons");
    const svg = createSVG(24, 24, "0 0 100 91",
        "M53.29 80.035l7.32.002 2.41 8.24 13.128-8.24h15.477v-67.98H53.29v67.978zm7.79-60.598h22.756v53.22h-8.73l-8.718 5.473-1.587-5.46-3.72-.012v-53.22zM46.818 43.162h-16.35c.545-8.467.687-16.12.687-22.955h15.987s.615-7.05-2.68-6.97H16.807c1.09-4.1 2.46-8.332 4.1-12.708 0 0-7.523 0-10.085 6.74-1.06 2.78-4.128 13.48-9.592 24.41 1.84-.2 7.927-.37 11.512-6.94.66-1.84.785-2.08 1.605-4.54h9.02c0 3.28-.374 20.9-.526 22.95H6.51c-3.67 0-4.863 7.38-4.863 7.38H22.14C20.765 66.11 13.385 79.24 0 89.62c6.403 1.828 12.784-.29 15.937-3.094 0 0 7.182-6.53 11.12-21.64L43.92 85.18s2.473-8.402-.388-12.496c-2.37-2.788-8.768-10.33-11.496-13.064l-4.57 3.627c1.363-4.368 2.183-8.61 2.46-12.71H49.19s-.027-7.38-2.372-7.38zm128.752-.502c6.51-8.013"
    );
    svg.addClasses("ZiExt--Main");
    svg.setAttribute("fill", "#ff7000");
    svg.title = "回答池";
    const btn = createButton(["CornerButton", "Button--plain"], "");
    btn.dataset.tooltip = "回答池";
    btn.dataset.tooltipPosition = "left";
    btn.appendChild(svg);
    const btndiv = document.createElement("div");
    btndiv.addClass("CornerAnimayedFlex");
    btndiv.appendChild(btn);
    if (fbtns)
        fbtns.prepend(btndiv);
});

bodyObserver.observe(document.body, { "childList": true, "subtree": true });

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse)
{
    switch (request.action)
    {
        case "click":
            $(request.objname).click();
            break;
    }
}); 
