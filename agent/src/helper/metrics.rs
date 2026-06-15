use std::collections::VecDeque;

/// 趋势方向枚举，通过比较前半段与后半段的均值变化判定
#[derive(Debug, Clone, PartialEq)]
pub enum Trend {
	Rising,
	Falling,
	Stable,
}

/// 基于环形缓冲区的指标聚合器
///
/// 使用 VecDeque 存储最近 N 个采样值，提供统计聚合与趋势检测能力。
/// 默认容量为 60（适合每秒采样一次、保留最近一分钟数据的场景）。
pub struct MetricsAggregator {
	buffer: VecDeque<f64>,
	capacity: usize,
}

impl MetricsAggregator {
	pub fn new(capacity: usize) -> Self {
		Self {
			buffer: VecDeque::with_capacity(capacity),
			capacity,
		}
	}

	/// 默认容量 60 个采样点
	pub fn default() -> Self {
		Self::new(60)
	}

	/// 推入一个新采样值；若缓冲区已满则移除最旧的值
	pub fn push(&mut self, value: f64) {
		if self.buffer.len() >= self.capacity {
			self.buffer.pop_front();
		}
		self.buffer.push_back(value);
	}

	/// 当前缓冲区中的采样数
	pub fn len(&self) -> usize {
		self.buffer.len()
	}

	/// 计算所有采样值的算术平均值，缓冲区为空时返回 0.0
	pub fn avg(&self) -> f64 {
		if self.buffer.is_empty() {
			return 0.0;
		}
		let sum: f64 = self.buffer.iter().sum();
		sum / self.buffer.len() as f64
	}

	/// 返回最大值，缓冲区为空时返回 f64::NEG_INFINITY
	pub fn max(&self) -> f64 {
		self.buffer
			.iter()
			.copied()
			.fold(f64::NEG_INFINITY, f64::max)
	}

	/// 返回最小值，缓冲区为空时返回 f64::INFINITY
	pub fn min(&self) -> f64 {
		self.buffer
			.iter()
			.copied()
			.fold(f64::INFINITY, f64::min)
	}

	/// 计算 P95（第 95 百分位数），缓冲区为空时返回 0.0
	///
	/// 使用最近邻插值法：对排序后的数据取 ceil(0.95 * N) - 1 位置的值
	pub fn p95(&self) -> f64 {
		if self.buffer.is_empty() {
			return 0.0;
		}
		let mut sorted: Vec<f64> = self.buffer.iter().copied().collect();
		sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

		let index = ((0.95 * sorted.len() as f64).ceil() as usize).saturating_sub(1);
		let index = index.min(sorted.len() - 1);
		sorted[index]
	}

	/// 趋势检测：将缓冲区分为前后两半，比较两半的均值差异
	///
	/// 当后半段均值 - 前半段均值 > threshold 时判定为 Rising，
	/// 当前半段均值 - 后半段均值 > threshold 时判定为 Falling，
	/// 否则为 Stable。
	///
	/// 缓冲区样本不足 2 个时始终返回 Stable。
	pub fn detect_trend(&self, threshold: f64) -> Trend {
		if self.buffer.len() < 2 {
			return Trend::Stable;
		}

		let mid = self.buffer.len() / 2;
		let first_half_sum: f64 = self.buffer.iter().take(mid).sum();
		let second_half_sum: f64 = self.buffer.iter().skip(mid).sum();
		let first_half_avg = first_half_sum / mid as f64;
		let second_half_avg = second_half_sum / (self.buffer.len() - mid) as f64;

		let diff = second_half_avg - first_half_avg;
		if diff > threshold {
			Trend::Rising
		} else if diff < -threshold {
			Trend::Falling
		} else {
			Trend::Stable
		}
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn test_new_and_default() {
		let agg = MetricsAggregator::new(10);
		assert_eq!(agg.len(), 0);
		assert_eq!(agg.capacity, 10);

		let agg_default = MetricsAggregator::default();
		assert_eq!(agg_default.capacity, 60);
	}

	#[test]
	fn test_push_within_capacity() {
		let mut agg = MetricsAggregator::new(5);
		for i in 1..=5 {
			agg.push(i as f64);
		}
		assert_eq!(agg.len(), 5);
	}

	#[test]
	fn test_push_exceeds_capacity_evicts_oldest() {
		let mut agg = MetricsAggregator::new(3);
		agg.push(1.0);
		agg.push(2.0);
		agg.push(3.0);
		agg.push(4.0); // 应移除 1.0

		assert_eq!(agg.len(), 3);
		// 缓冲区应为 [2.0, 3.0, 4.0]
		assert_eq!(agg.min(), 2.0);
		assert_eq!(agg.max(), 4.0);
	}

	#[test]
	fn test_avg_empty() {
		let agg = MetricsAggregator::new(10);
		assert_eq!(agg.avg(), 0.0);
	}

	#[test]
	fn test_avg() {
		let mut agg = MetricsAggregator::new(10);
		agg.push(10.0);
		agg.push(20.0);
		agg.push(30.0);
		assert!((agg.avg() - 20.0).abs() < f64::EPSILON);
	}

	#[test]
	fn test_max_min() {
		let mut agg = MetricsAggregator::new(10);
		agg.push(5.0);
		agg.push(1.0);
		agg.push(9.0);
		agg.push(3.0);
		assert_eq!(agg.max(), 9.0);
		assert_eq!(agg.min(), 1.0);
	}

	#[test]
	fn test_p95_single_element() {
		let mut agg = MetricsAggregator::new(10);
		agg.push(42.0);
		assert_eq!(agg.p95(), 42.0);
	}

	#[test]
	fn test_p95_multiple() {
		let mut agg = MetricsAggregator::new(100);
		// 推入 1..=100
		for i in 1..=100 {
			agg.push(i as f64);
		}
		// P95 应为第 95 个值
		assert_eq!(agg.p95(), 95.0);
	}

	#[test]
	fn test_p95_empty() {
		let agg = MetricsAggregator::new(10);
		assert_eq!(agg.p95(), 0.0);
	}

	#[test]
	fn test_detect_trend_rising() {
		let mut agg = MetricsAggregator::new(10);
		// 前半段低，后半段高
		for i in 1..=10 {
			agg.push(i as f64);
		}
		// 前半段均值: (1+2+3+4+5)/5 = 3.0
		// 后半段均值: (6+7+8+9+10)/5 = 8.0
		// 差值 5.0 > 1.0
		assert_eq!(agg.detect_trend(1.0), Trend::Rising);
	}

	#[test]
	fn test_detect_trend_falling() {
		let mut agg = MetricsAggregator::new(10);
		// 前半段高，后半段低
		for i in (1..=10).rev() {
			agg.push(i as f64);
		}
		// 前半段均值: (10+9+8+7+6)/5 = 8.0
		// 后半段均值: (5+4+3+2+1)/5 = 3.0
		// 差值 -5.0 < -1.0
		assert_eq!(agg.detect_trend(1.0), Trend::Falling);
	}

	#[test]
	fn test_detect_trend_stable() {
		let mut agg = MetricsAggregator::new(10);
		for _ in 0..10 {
			agg.push(5.0);
		}
		assert_eq!(agg.detect_trend(1.0), Trend::Stable);
	}

	#[test]
	fn test_detect_trend_insufficient_samples() {
		let mut agg = MetricsAggregator::new(10);
		agg.push(1.0);
		// 只有 1 个样本，应返回 Stable
		assert_eq!(agg.detect_trend(0.1), Trend::Stable);
	}

	#[test]
	fn test_detect_trend_two_samples() {
		let mut agg = MetricsAggregator::new(10);
		agg.push(1.0);
		agg.push(10.0);
		// mid = 1, 前半段 [1.0] avg=1.0, 后半段 [10.0] avg=10.0, diff=9.0
		assert_eq!(agg.detect_trend(5.0), Trend::Rising);
	}
}
