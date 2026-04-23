封装实现 **ali-web-search** skill

### 需求

参考/Users/admin/clawd/skills/search_arxiv，用python在/Users/admin/clawd/skills目录中封装实现 **ali-web-search** skill。

ali_web_search中调用的搜索请求API，参考后面的curl示例。

#### 输入

- 待查询的字符串，必填
- 返回结果数量，选填。默认为10。
- 查询时间范围，选填。默认OneMonth。
- **run_id**：用于隔离不同次执行的进度文件，选填。

查询时间范围可选值：

- **OneDay**：1天内
- **OneWeek**：1周内
- **OneMonth**：1月内
- **OneYear**：1年内（默认值）
- **NoLimit**：无限制

#### 输出

查询结果数组。

```json
[
  {
    "title": "",
    "link": "",
    "publishedTime": "2025-06-14T09:13:50+08:00",
    "mainText": ""
  },
  {}
]
```

#### 搜索API的curl示例

- **请求示例**

```shell
curl  -X POST https://cloud-iqs.aliyuncs.com/search/unified \
--header "Authorization: Bearer $ALI_WEB_API_KEY" \
--header "Content-Type: application/json" \
--data '{
  "query": "人工智能 state of the art OR latest advancements",
  "engineType": "LiteAdvanced",
  “timeRange”: "OneMonth",
  "category": null,
  "contents": {
    "mainText": true,
    "markdownText":false,
    "summary": false,
    "rerankScore": true
  },
  "advancedParams":{
    "numResults": 2
  }
}'
```

- **返回示例**

```json
{
  "requestId": "190790e8-a665-4f9b-8a46-fc0e46119d4c",
  "pageItems": [
    {
      "title": "Spring AI 1.0.0 Tool Calling 震撼揭秘：手撕源码，玩转AI工具调用，让你的代码拥有“上帝之手”！",
      "link": "https://m.blog.csdn.net/weixin_47905944/article/details/148628261",
      "snippet": "截至2023年，人工智能（AI）领域在多个方面取得了显著进展。 以下是一些关键领域的最新情况： 1. **自然语言处理（NLP）**： - 大型语言模型（LLMs）如GPT-4、BERT等继续推动NLP技术的进步。 这些模型能够生成高质量的文本，进行复杂的对话，并完成多种任务，如翻译、摘要和问答。 - 模型的上下文理解和多语言支持能力显著增强，使得跨语言应用更加广泛。 2. **计算机视觉**： - AI在图像识别、物体检测和视频分析方面的准确性持续提高。 新技术如Vision Transformers（ViTs）正在取代传统的卷积神经网络（CNNs），提供更好的性能 and 效率。 - 实时视频分析和增强现实（AR）应用变得更加普遍，尤其是在移动设备上。 3. **强化学习**： - 强化学习在游戏、机器人控制和自动驾驶等领域取得了突破。 例如，AlphaStar在星际争霸II中展现了超越人类玩家的能力。 - 新s的算法和技术，如深度确定性策略梯度（DDPG）和软演员-评论家（SAC），提高了学习效率和稳定性。 4. **生成对抗网络（GANs）**： - GANs在图像生成、风格迁移和数据增强方面表现优异。 最新的进展包括StyleGAN系列，能够生成高度逼真的图像。 - 文本到图像的生成模型，如DALL·E 2，能够根据文本描述生成复杂且高质量的图像。 5.",
      "publishedTime": "2025-06-14T09:13:50+08:00",
      "mainText": "前言\n 工具调用（亦称函数调用）是  AI 应用 的常见模式，允许模型通过与一组 API（即工具）交互来扩展其能力。\n工具主要应用于以下场景：\n信息检索。  此类工具可用于从外部源检索信息，例如数据库、网络服务、文件系统或网络搜索引擎。其目的是增强模型的知识，使其能够回答原本无法回答的问题。因此，它们可用于检索增强生成（RAG）场景。例如，可以使用工具检索给定位置的当前天气、检索最新新闻文章或查询数据库中的特定记录。\n执行操作。  此类工具可用于在软件系统中执行操作，例如发送电子邮件、在数据库中创建新记录、提交表单或触发工作流。其目的是自动化那些原本需要人工干预或显式编程的任务。例如，可以使用工具为与聊天机器人交互的客户预订航班、填写网页上的表单，或在代码生成场景中基于自动化测试（TDD）实现 Java 类。\n尽管我们通常将工具调用称为模型能力，但实际上工具调用逻辑是由客户端应用程序提供的。模型只能请求工具调用并提供输入参数，而应用程序负责根据输入参数执行工具调用并返回结果。模型永远无法访问作为工具提供的任何 API，这是一个关键的安全考量。\nSpring AI 提供了便捷的 API 来定义工具、解析模型的工具调用请求以及执行工具调用。以下部分概述了 Spring AI 中的工具调用功能。\n接着来实操下\n定义Tool\n先来看一个不用tool的案例\n@Resource private ChatClient . Builder  chatClient ; @GetMapping ( \"/toolChat\" ) public String toolChat ( @RequestParam ( \"message\" ) String  message ) { Logger . info ( chatClient ) ; return  chatClient . build ( ) . prompt ( ) . user ( message ) . call ( ) . content ( ) ; }\nAI生成项目 java\n运行\n1 2 3 4 5 6 7 8 9 10 11 12 13\n执行 http://localhost:8080/toolChat?message=汇总当前AI最新的发展\n 输出结果\n截至2023年，人工智能（AI）领域在多个方面取得了显著进展。以下是一些关键领域的最新情况： 1. **自然语言处理（NLP）**： - 大型语言模型（LLMs）如GPT-4、BERT等继续推动NLP技术的进步。这些模型能够生成高质量的文本，进行复杂的对话，并完成多种任务，如翻译、摘要和问答。 - 模型的上下文理解和多语言支持能力显著增强，使得跨语言应用更加广泛。 2. **计算机视觉**： - AI在图像识别、物体检测和视频分析方面的准确性持续提高。新技术如Vision Transformers（ViTs）正在取代传统的卷积神经网络（CNNs），提供更好的性能和效率。 - 实时视频分析和增强现实（AR）应用变得更加普遍，尤其是在移动设备上。 3. **强化学习**： - 强化学习在游戏、机器人控制和自动驾驶等领域取得了突破。例如，AlphaStar在星际争霸II中展现了超越人类玩家的能力。 - 新的算法和技术，如深度确定性策略梯度（DDPG）和软演员-评论家（SAC），提高了学习效率和稳定性。 4. **生成对抗网络（GANs）**： - GANs在图像生成、风格迁移和数据增强方面表现优异。最新的进展包括StyleGAN系列，能够生成高度逼真的图像。 - 文本到图像的生成模型，如DALL·E 2，能够根据文本描述生成复杂且高质量的图像。 5. **伦理与安全**： - 随着AI的应用越来越广泛，伦理问题和安全性成为研究的重点。偏见、隐私保护和透明度是主要关注点。 - 各国政府和组织正在制定政策和标准，以确保AI的负责任使用。 6. **边缘AI与物联网（IoT）**： - 边缘计算结合AI技术，使得智能设备能够在本地处理数据，减少延迟并提高隐私保护。 - AI驱动的IoT设备在智能家居、工业自动化和医疗健康领域得到广泛应用。 7. **量子AI**： - 虽然仍处于早期阶段，但量子计算与AI的结合为解决复杂问题提供了新的可能性。各大科技公司和研究机构正在积极探索这一领域。 总体而言，AI技术正在快速发展，并逐渐融入我们的日常生活。随着计算能力的提升和算法的改进，未来AI将在更多领域展现出其潜力和价值。\n使用工具，先定义工具：\npackage com . example . tool ; import org . springframework . ai . tool . annotation . Tool ; import org . tinylog . Logger ; import java . time . LocalDateTime ; public class CustomerTool { @Tool ( description  = \"获取当前时间\" ) String getCurrentDateTime ( ) { Logger . info ( \"获取当前时间\" ) ; return LocalDateTime . now ( ) . toString ( ) ; } }\nAI生成项目 java\n运行\n1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18\n然后再配置工具：\n@Resource private ChatClient . Builder  chatClient ; @GetMapping ( \"/toolChat\" ) public String toolChat ( @RequestParam ( \"message\" ) String  message ) { Logger . info ( chatClient ) ; return  chatClient . build ( ) . prompt ( ) . user ( message ) . tools ( new CustomerTool ( ) ) . call ( ) . content ( ) ; }\nAI生成项目 java\n运行\n1 2 3 4 5 6 7 8 9 10 11 12 13\n根据刚才查询到的当前时间，现在是2025年6月13日。因此，我的回答涵盖了直到这个日期为止AI领域的最新情况。如果您需要更详细或者特定方面的信息，请告诉我，我将尽力提供帮助。\n 后端日志\n检索到的信息比较老 于是尝试获取最新的时间 ，然后给出了结果\n 再搜索一次日期\n工具执行结果直接返回returnDirect\n@Tool ( description  = \"根据城市编号获取当前的天气\" , returnDirect  = true ) String currentWeather ( String  no ) throws Exception { Logger . info ( \"当前城市编号：\" +  no ) ; String  result  = Objects . re...",
      "markdownText": null,
      "richMainBody": null,
      "images": [],
      "hostname": "CSDN技术社区",
      "hostLogo": "https://s2.zimgs.cn/ims?kt=url&at=smstruct&key=aHR0cHM6Ly9jc2RuaW1nLmNuL3B1YmxpYy9mYXZpY29uLmljbw==&sign=yx:i3vHwmA6PYepbEbc4Ys41enOFKM=&tv=400_400",
      "summary": null,
      "rerankScore": 0.9832035130446983,
      "hostAuthorityScore": null,
      "websiteAuthorityScore": 3,
      "correlationTag": null,
      "tags": {
        "genre": "Blog",
        "isUgc": "true",
        "industry": "Tech",
        "ugcType": "TechTutorial",
        "isListPage": "false"
      }
    },
    {
      "title": "人工智能最新进展：探索前沿技术与成果",
      "link": "https://m.itangsoft.com/baike/show-798728.html",
      "snippet": "导读人工智能（AI）的最新进展是多方面的，涵盖了机器学习、自然语言处理、计算机视觉、机器人学等多个领域。以下是一些最新的技术和成果。人工智能（AI）的最新进展是多方面的，涵盖了机器学习、自然语言处理、计算机视觉、机器人学等多个领域。以下是一些最新的技术和成果：1. 深度学习的突破：深度学习是AI领域的核心技术之一，它通过模仿人脑神经元的工作方式来训练模型。近年来，深度学习在图像识别、语音识别和自然语言处理等领域取得了显著进展。例如，谷歌的BERT模型在理解上下文方面超越了之前的模型，而WMT 2019比赛则展示了深度学习在机器翻译领域的新突破。2. 强化学习的新进展：强化学习是一种让机器通过与环境的交互来学习和改进的方法。近年来，强化学习在游戏、自动驾驶、机器人等领域取得了重要进展。例如，DeepMind的AlphaGo in 围棋比赛中战胜了世界冠军李世石，展示了强化学习的潜力。",
      "publishedTime": "2025-04-23T00:00:00+08:00",
      "mainText": "导读\n人工智能（AI）的最新进展是多方面的，涵盖了机器学习、自然语言处理、计算机视觉、机器人学等多个领域。以下是一些最新的技术和成果。\n人工智能（AI）的最新进展是多方面的，涵盖了机器学习、自然语言处理、计算机视觉、机器人学等多个领域。以下是一些最新的技术和成果：\n1. 深度学习的突破：深度学习是AI领域的核心技术之一，它通过模仿人脑神经元的工作方式来训练模型。近年来，深度学习在图像识别、语音识别和自然语言处理等领域取得了显著进展。例如，谷歌的BERT模型在理解上下文方面超越了之前的模型，而WMT 2019比赛则展示了深度学习在机器翻译领域的新突破。\n2. 强化学习的新进展：强化学习是一种让机器通过与环境的交互来学习和改进的方法。近年来，强化学习在游戏、自动驾驶、机器人等领域取得了重要进展。例如，DeepMind的AlphaGo在围棋比赛中战胜了世界冠军李世石，展示了强化学习的潜力。\n3. 计算机视觉的新突破：计算机视觉是让机器能够理解和解释图像或视频的技术。近年来，计算机视觉在物体检测、人脸识别、视频分析等领域取得了重要进展。例如，YOLO（You Only Look Once）等算法在实时目标检测方面取得了突破，而GAN（生成对抗网络）则在图像合成方面展现了巨大潜力。\n4. 自然语言处理的新进展：自然语言处理是让机器能够理解和生成人类语言的技术。近年来，自然语言处理在对话系统、文本摘要、情感分析等领域取得了重要进展。例如，OpenAI的GPT系列模型在文本生成方面取得了重大突破，而BERT等模型则在理解上下文方面展现了巨大潜力。\n5. 机器人学的新技术：机器人学是研究机器人设计、制造和应用的学科。近年来，机器人学在自主导航、协作机器人、机器人手术等领域取得了重要进展。例如，ROS（Robot Operating System）等开源平台为机器人开发提供了便利，而RoboMaster等竞赛则推动了机器人技术的发展。\n6. 量子计算与AI的结合：量子计算是一种利用量子力学原理进行计算的新型计算技术。近年来，量子计算与AI的结合为解决传统计算无法解决的问题提供了新的可能性。例如，Google的D-Wave 2量子计算机在量子模拟和优化方面取得了重要进展，而IBM的Qiskit等工具则为量子计算与AI的融合提供了便利。\n7. 伦理与监管问题：随着AI技术的不断发展，伦理与监管问题也日益凸显。如何确保AI技术的公平性、透明度和安全性，以及如何处理隐私保护、数据安全等问题，都是当前AI领域需要关注的重要议题。\n总之，人工智能的最新进展涵盖了多个领域，包括深度学习、强化学习、计算机视觉、自然语言处理、机器人学、量子计算与AI的结合以及伦理与监管问题等。这些进展不仅推动了AI技术的发展，也为人类社会带来了新的机遇和挑战。",
      "markdownText": null,
      "richMainBody": null,
      "images": [],
      "hostname": "m.itangsoft.com",
      "hostLogo": null,
      "summary": null,
      "rerankScore": 0.8591587945108007,
      "hostAuthorityScore": null,
      "websiteAuthorityScore": 2,
      "correlationTag": null,
      "tags": {}
    }
  ],
  "sceneItems": [],
  "searchInformation": { "searchTime": 543 },
  "queryContext": {
    "engineType": "LiteAdvanced",
    "originalQuery": {
      "query": "人工智能 state of the art OR latest advancements",
      "timeRange": "NoLimit"
    },
    "rewrite": { "enabled": false, "timeRange": null }
  },
  "costCredits": {
    "search": { "genericTextSearch": 0, "liteTextSearch": 0, "liteAdvancedTextSearch": 1 },
    "valueAdded": { "summary": 0, "advanced": 0 }
  }
}
```

---

### SOP 观测支持 (SOP Observation Support)

为了支持 AIEMAS 平台的 SOP 进度实时观测，本技能遵循以下规范：

1. **进度文件路径**：`~/.openclaw/workspace-<agentId>/<run_id>_ali_web_search.progress.jsonl`
2. **上报机制**：使用 `lib.progress.ProgressReporter` 模块。
3. **上报内容**：
   - `start`：技能开始执行。
   - `item`：上报检索进度。
   - `log`：上报关键逻辑节点的执行日志。
   - `done`：执行完成。
