import { useNavigate } from 'react-router-dom';

import { Button, Card, KeyValue, PageHeader, Tag } from '../components/ui';

export default function PointsRules() {
  const navigate = useNavigate();

  return (
    <>
      <PageHeader title="积分规则" desc="当前积分只记录发放与扣回，不参与订单抵扣" />

      <Card title="积分的产生">
        <p style={{ marginTop: 0 }}>
          订单支付成功后，按实付金额发放积分：每 1 元计 1 分，向下取整。例如实付 ¥99.90，发放 99 分。
        </p>
        <KeyValue
          items={[
            { label: '发放时点', value: '订单支付成功' },
            { label: '计算口径', value: '实付金额（整数分）÷ 100，向下取整' },
            { label: '发放流水', value: <Tag tone="ok">ORDER_PAID</Tag> },
          ]}
        />
      </Card>

      <Card title="积分的扣回">
        <p style={{ marginTop: 0 }}>
          退款成功时按相同口径扣回积分。若客户积分已被使用或不足，扣减后余额最低为 0，不会出现负积分。
        </p>
        <KeyValue
          items={[
            { label: '扣回时点', value: '退款成功' },
            { label: '计算口径', value: '退款金额（整数分）÷ 100，向下取整' },
            { label: '流水来源', value: <Tag tone="warn">REFUND</Tag> },
          ]}
        />
      </Card>

      <Card title="使用范围">
        <p style={{ marginTop: 0 }}>
          当前版本积分不参与订单金额抵扣，仅作为会员成长与运营激励的记录。后台可按需手动调整积分。
        </p>
        <div className="row">
          <Tag tone="brand">MANUAL</Tag>
          <span className="small muted">手动调整会写入积分流水，并校验余额不为负。</span>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Button variant="ghost" onClick={() => navigate('/customers')}>
            前往客户列表调整积分
          </Button>
        </div>
      </Card>

      <Card title="流水来源">
        <KeyValue
          items={[
            { label: 'ORDER_PAID', value: '订单支付成功发放' },
            { label: 'REFUND', value: '订单退款成功扣回' },
            { label: 'ADMIN', value: '后台手动发放 / 扣减' },
          ]}
        />
      </Card>
    </>
  );
}
