import { Text, View } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';

import {
  AGREEMENT_TITLES,
  AGREEMENT_VERSIONS,
  type AgreementType,
} from '@shanye/shared/src/agreements';

import './index.css';

interface Section {
  title: string;
  paragraphs: string[];
}

const TERMS: Section[] = [
  {
    title: '一、服务说明',
    paragraphs: [
      '山野商城为微信用户提供商品浏览、下单、支付、自提与同城配送等服务。你使用本小程序即表示接受本协议。',
      '商品信息、价格与库存以页面展示为准；如遇缺货或价格异常，我们会在发货前与你沟通处理。',
    ],
  },
  {
    title: '二、账号与登录',
    paragraphs: [
      '你通过微信授权登录并创建账号。请妥善保管微信账号，因账号出借、转让造成的损失由你自行承担。',
      '你需要年满 18 周岁，或征得监护人同意后使用本服务。',
    ],
  },
  {
    title: '三、订单与支付',
    paragraphs: [
      '提交订单前请确认商品、数量、收货信息与履约方式；支付成功后订单生效。',
      '支付通过微信支付完成，我们不会存储你的银行卡或支付密码。',
    ],
  },
  {
    title: '四、配送与自提',
    paragraphs: [
      '同城配送按下单时选择的时段送达；到店自提请凭核销码在门店营业时间内取货。',
      '因不可抗力或门店临时打烊导致延迟，我们会通过订单状态与短信/小程序消息告知。',
    ],
  },
  {
    title: '五、售后与退款',
    paragraphs: [
      '符合售后规则的订单可申请退款或退货退款，审核通过后原路退回。',
      '生鲜及已拆封食品等不适用无理由退货，具体以商品页面说明为准。',
    ],
  },
  {
    title: '六、行为规范',
    paragraphs: [
      '不得利用本服务从事虚假交易、恶意退款、批量注册、爬取数据等行为；违规时我们有权限制账号使用。',
    ],
  },
  {
    title: '七、协议变更与联系',
    paragraphs: [
      '协议更新时会在小程序内提示，你需重新确认后方可继续使用。',
      '如有疑问，可通过「我的 → 联系客服」与我们联系。',
    ],
  },
];

const PRIVACY: Section[] = [
  {
    title: '一、我们收集的信息',
    paragraphs: [
      '登录信息：微信 openid，用于识别你的账号。',
      '联系方式：手机号，用于订单通知、配送联系与售后沟通。',
      '交易信息：订单商品、金额、支付状态、自提或配送记录。',
      '地址信息：收货人、联系电话与收货地址，仅用于履约。',
      '必要设备信息：用于保障账号与交易安全。',
    ],
  },
  {
    title: '二、信息的使用',
    paragraphs: [
      '用于完成下单、支付、履约、售后与客户服务。',
      '用于会员等级、积分与优惠权益的计算与展示。',
      '用于安全风控与异常订单识别，不用于与上述无关的用途。',
    ],
  },
  {
    title: '三、共享与委托处理',
    paragraphs: [
      '微信支付：用于完成支付与退款。',
      '配送服务：向门店或配送人员提供必要的收货信息。',
      '除法律法规要求或取得你的单独同意外，我们不会向第三方出售或共享你的个人信息。',
    ],
  },
  {
    title: '四、存储与保护',
    paragraphs: [
      '信息存储于中国境内的服务器，采取访问控制、加密传输等措施保护数据安全。',
      '订单与交易记录按法律法规要求的期限保存；超期后删除或匿名化。',
    ],
  },
  {
    title: '五、你的权利',
    paragraphs: [
      '你可以查询、更正个人资料与收货地址，也可以删除非必需信息。',
      '你可以申请注销账号；注销后账号数据将被删除或匿名化，法律法规另有要求的除外。',
    ],
  },
  {
    title: '六、未成年人保护',
    paragraphs: [
      '未成年人应在监护人指导下使用本服务；如监护人发现未成年人未经同意使用，可联系我们处理。',
    ],
  },
  {
    title: '七、政策更新与联系',
    paragraphs: [
      '隐私政策更新时会在小程序内提示并重新征得你的同意。',
      '如需行使上述权利或有疑问，可通过「我的 → 联系客服」联系我们。',
    ],
  },
];

export default function Page() {
  const router = useRouter();
  const type: AgreementType = router.params.type === 'privacy' ? 'privacy' : 'terms';
  const sections = type === 'privacy' ? PRIVACY : TERMS;

  return (
    <View className="page agreement-page">
      <Text className="agreement-title">{AGREEMENT_TITLES[type]}</Text>
      <Text className="muted tiny agreement-meta">
        版本 {AGREEMENT_VERSIONS[type]} · 生效日期 2026-11-01
      </Text>

      {sections.map((section) => (
        <View className="agreement-section" key={section.title}>
          <Text className="agreement-heading">{section.title}</Text>
          {section.paragraphs.map((paragraph) => (
            <Text className="agreement-paragraph" key={paragraph}>
              {paragraph}
            </Text>
          ))}
        </View>
      ))}

      <Text className="muted tiny agreement-foot">
        完整文本以门店公示与客服提供的最新版本为准。
      </Text>
    </View>
  );
}
