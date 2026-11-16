export interface RecordSplitter {
	push: (chunk: Buffer) => void;
	end: () => void;
}

export function createRecordSplitter(
	onRecord: (record: Buffer) => void,
): RecordSplitter {
	let carry: Buffer | null = null;

	return {
		push(chunk) {
			let data = chunk;
			if (carry) {
				data = Buffer.concat([carry, chunk]);
				carry = null;
			}
			let start = 0;
			let nul = data.indexOf(0, start);
			while (nul !== -1) {
				onRecord(data.subarray(start, nul));
				start = nul + 1;
				nul = data.indexOf(0, start);
			}
			if (start < data.length) carry = Buffer.from(data.subarray(start));
		},
		end() {
			if (carry && carry.length > 0) onRecord(carry);
			carry = null;
		},
	};
}
