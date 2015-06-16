;(function(){

    // TODO: 
    // Enhancements - volumes are separately adjustable.

	var URL = window.URL || window.webkitURL;
	var Blob = window.Blob;

	if(!URL || !Blob) {
		throw new Error('This browser does not support AudioSynth');
	}

	var _encapsulated = false;

    /* Utility function. c: 0 for 2-byte data; 1 for 4-byte-data. arg: the data itself. */
	var pack = function(c, arg) {
        if (c === 0) {
            return new Uint8Array([arg, arg >> 8]);
        } else if (c === 1) {
            return new Uint8Array([arg, arg >> 8, arg >> 16, arg >> 24]);
        }
		throw new Error('Unsupported packing scheme.');
    };

	var setPrivateVar = function(n, v, w, e) {
        Object.defineProperty(this, n, {value: v, writable: !!w, enumerable: !!e});
    };

	var setPublicVar = function(n, v, w) {
        setPrivateVar.call(this, n, v, w, true);
    };

    /* Constructor */
	var AudioSynthInstrument = function () {
        this.__init__.apply(this, arguments);
    };

	var setPriv = setPrivateVar.bind(AudioSynthInstrument.prototype);
	var setPub = setPublicVar.bind(AudioSynthInstrument.prototype);

    // AudioSynthInstrument method
	setPriv('__init__', function(a, b, c) {
		if (!_encapsulated) { 
            throw new Error('AudioSynthInstrument can only be instantiated from the createInstrument method of the AudioSynth object.'); 
        }
		setPrivateVar.call(this, '_parent', a);
		setPublicVar.call(this, 'name', b);
		setPrivateVar.call(this, '_soundID', c);
	});

    // AudioSynthInstrument method
	setPub('play', function(note, octave, duration) {
		return this._parent.play(this._soundID, note, octave, duration, this._volume);
	});

    // AudioSynthInstrument method
	setPub('generate', function(note, octave, duration) {
		return this._parent.generate(this._soundID, note, octave, duration, this._volume);
	});

	setPriv('_volume', 32768, true);

    // AudioSynthInstrument method
	setPub('setVolume', function(v) {
		v = parseFloat(v); 
        if ( isNaN(v) ) { v = 0; }
		v = Math.round(v * 32768);
		this._volume = Math.max(Math.min(v|0, 32768), 0);
		this._parent._clearCache();
		return this._volume;
	});

    // AudioSynthInstrument method
	setPub('getVolume', function() { 
        return Math.round(this._volume / 32768 * 10000) / 10000; 
    });

    /* Constructor */
	var AudioSynth = function () {
        this.__init__(); 
    };

	setPriv = setPrivateVar.bind(AudioSynth.prototype);
	setPub = setPublicVar.bind(AudioSynth.prototype);

	setPriv('_debug', false, true);
	setPriv('_bitsPerSample', 16);
	setPriv('_channels', 1);
	setPriv('_sampleRate', 44100, true);

	setPub('setSampleRate', function(v) {
		this._sampleRate = Math.max(Math.min(v|0, 44100), 4000);
		this._clearCache();
		return this._sampleRate;
	});

	setPub('getSampleRate', function() { 
        return this._sampleRate; 
    });

	setPriv('_notes', {
        'C-': 246.94,
        'C': 261.63,
        'C#': 277.18,
        'D-': 277.18,
        'D': 293.66,
        'D#': 311.13,
        'E-': 311.13,
        'E': 329.63,
        'E#': 346.23,
        'F-': 329.63,
        'F': 346.23,
        'F#': 369.99,
        'G-': 369.99,
        'G': 392.00,
        'G#': 415.30,
        'A-': 415.30,
        'A': 440.00,
        'A#': 466.16,
        'B-': 466.16,
        'B': 493.88,
        'B#': 523.25
    });

	setPriv('_fileCache', [], true);
	setPriv('_temp', {}, true);
	setPriv('_sounds', [], true);
	setPriv('_mod', [
            function(i, s, f, x) {
                return Math.sin((2 * Math.PI) * (i / s) * f + x);
            }
    ]);
	setPriv('_reconstructCache', function() {
		var f = this._fileCache;
		var l = this._sounds.length;
		while(f.length < l) {
			var octaveList = [];
			for(var i = 0; i < 8; i++) {
				var noteList = {};
				for(var k in this._notes) {
					noteList[k] = {};
				} 
				octaveList.push(noteList);
			}
			f.push(octaveList);
		}
	});

	setPriv('_clearCache', function() {
		this._fileCache = [];
		this._reconstructCache();
	});

	setPub('generate', function(sound, note, octave, duration, volume) {
		var thisSound = this._sounds[sound];
		if(!thisSound) {
			for(var i=0, len = this._sounds.length; i < len; i++) {
				if(this._sounds[i].name == sound) {
					thisSound = this._sounds[i];
					sound = i;
					break;
				}
			}
		}
		if(!thisSound) { throw new Error('Invalid sound or sound ID: ' + sound); }
		var t = (new Date).valueOf();
		this._temp = {};
		octave |= 0;
		octave = Math.min(8, Math.max(1, octave));
		var time = !duration ? 2 : parseFloat(duration);
		if(typeof(this._notes[note]) == 'undefined') { 
            throw new Error(note + ' is not a valid note.'); 
        }
		if(typeof(this._fileCache[sound][octave - 1][note][time]) != 'undefined') {
			if(this._debug) { 
                console.log((new Date).valueOf() - t, 'ms to retrieve (cached)'); 
            }
			return this._fileCache[sound][octave - 1][note][time];
		} else {
            // Cache miss. Let's get to work.
			var frequency = this._notes[note] * Math.pow(2, octave-4);
			var sampleRate = this._sampleRate;
			var volume = volume || 32768;
			var channels = this._channels;
			var bitsPerSample = this._bitsPerSample;
			var attack = thisSound.attack(sampleRate, frequency, volume);
			var dampen = thisSound.dampen(sampleRate, frequency, volume);
			var waveFunc = thisSound.wave;
			var waveBind = {modulate: this._mod, vars: this._temp};
			var val = 0;

			var data = new Uint8Array(new ArrayBuffer(Math.ceil(sampleRate * time * 2)));
			var attackLen = (sampleRate * attack) || 1;
			var decayLen = (sampleRate * time) || 1;

			for (var i = 0 | 0; i !== attackLen; i++) {
		
				val = volume * 
                    // Modulate the amplitude.
                    (i / attackLen) * 
                    waveFunc.call(waveBind, i, sampleRate, frequency, volume);

				data[i << 1] = val;
				data[(i << 1) + 1] = val >> 8;

			}

			for (;i !== decayLen; i++) {

				val = volume * 
                    // Modulate the amplitude.
                    Math.pow((1 - ((i - (sampleRate * attack)) / (sampleRate * (time - attack)))), dampen) * 
                    waveFunc.call(waveBind, i, sampleRate, frequency, volume);

				data[i << 1] = val;
				data[(i << 1) + 1] = val >> 8;

			}

			var out = [
				'RIFF',
				pack(1, 4 + (8 + 24/* chunk 1 length */) + (8 + 8/* chunk 2 length */)), // Length
				'WAVE',
				// chunk 1
				'fmt ', // Sub-chunk identifier
				pack(1, 16), // Chunk length
				pack(0, 1), // Audio format (1 is linear quantization)
				pack(0, channels),
				pack(1, sampleRate),
				pack(1, sampleRate * channels * bitsPerSample / 8), // Byte rate
				pack(0, channels * bitsPerSample / 8),
				pack(0, bitsPerSample),
				// chunk 2
				'data', // Sub-chunk identifier
				pack(1, data.length * channels * bitsPerSample / 8), // Chunk length
				data
			];
			var blob = new Blob(out, {type: 'audio/wav'});
			var dataURI = URL.createObjectURL(blob);
			this._fileCache[sound][octave - 1][note][time] = dataURI;
			if(this._debug) { 
                console.log((new Date).valueOf() - t, 'ms to generate');
            }
			return dataURI;
		}
	});

	setPub('play', function(sound, note, octave, duration, volume) {
		var src = this.generate(sound, note, octave, duration, volume);
		var audio = new Audio(src);
		audio.play();
		return true;
	});

	setPub('debug', function() { 
        this._debug = true; 
    });

	setPub('createInstrument', function(sound) {
		var n = 0;
		var found = false;
		if(typeof(sound) == 'string') {
			for(var i = 0, len = this._sounds.length; i < len; i++) {
				if(this._sounds[i].name == sound) {
					found = true;
					n = i;
					break;
				}
			}
		} else {
			if(this._sounds[sound]) {
				n = sound;
				sound = this._sounds[n].name;
				found = true;
			}
		}
		if(!found) { 
            throw new Error('Invalid sound or sound ID: ' + sound); 
        }
		_encapsulated = true;
		var ins = new AudioSynthInstrument(this, sound, n);
		_encapsulated = false;
		return ins;
	});

	setPub('listSounds', function() {
		var r = [];
		for(var i = 0; i < this._sounds.length; i++) {
			r.push(this._sounds[i].name);
		}
		return r;
	});

	setPriv('__init__', function(){
		this._reconstructCache();
	});

	setPub('loadSoundProfile', function() {
		for(var i = 0, len = arguments.length; i < len; i++) {
			o = arguments[i];
			if(!(o instanceof Object)) { throw new Error('Invalid sound profile.'); }
			this._sounds.push(o);
		}
		this._reconstructCache();
		return true;
	});

	setPub('loadModulationFunction', function() {
		for(var i = 0, len = arguments.length; i < len; i++) {
			f = arguments[i];
			if(typeof(f) != 'function') { 
                throw new Error('Invalid modulation function.'); 
            }
			this._mod.push(f);
		}
		return true;
	});

	window.Synth = new AudioSynth();
})();

Synth.loadModulationFunction(
	function(i, sampleRate, frequency, x) { return 1 * Math.sin(2 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 1 * Math.sin(4 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 1 * Math.sin(8 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 1 * Math.sin(0.5 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 1 * Math.sin(0.25 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 0.5 * Math.sin(2 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 0.5 * Math.sin(4 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 0.5 * Math.sin(8 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 0.5 * Math.sin(0.5 * Math.PI * ((i / sampleRate) * frequency) + x); },
	function(i, sampleRate, frequency, x) { return 0.5 * Math.sin(0.25 * Math.PI * ((i / sampleRate) * frequency) + x); }
);

Synth.loadSoundProfile({
	name: 'piano',
	attack: function() { return 0.002; },
	dampen: function(sampleRate, frequency, volume) {
		return Math.pow(0.5 * Math.log((frequency * volume) / sampleRate), 2);
	},
	wave: function(i, sampleRate, frequency, volume) {
		var base = this.modulate[0];
		return this.modulate[1](
			i,
			sampleRate,
			frequency,
			Math.pow(base(i, sampleRate, frequency, 0), 2) +
				(0.75 * base(i, sampleRate, frequency, 0.25)) +
				(0.1 * base(i, sampleRate, frequency, 0.5))
		);
	}
},
{
	name: 'organ',
	attack: function() { return 0.3 },
	dampen: function(sampleRate, frequency) { return 1 + (frequency * 0.01); },
	wave: function(i, sampleRate, frequency) {
		var base = this.modulate[0];
		return this.modulate[1](
			i,
			sampleRate,
			frequency,
			base(i, sampleRate, frequency, 0) +
				0.5*base(i, sampleRate, frequency, 0.25) +
				0.25*base(i, sampleRate, frequency, 0.5)
		);
	}
},
{
	name: 'acoustic',
	attack:	function() { return 0.002; },
	dampen: function() { return 1; },
	wave: function(i, sampleRate, frequency) {

		var vars = this.vars;
		vars.valueTable = !vars.valueTable?[]:vars.valueTable;
		if(typeof(vars.playVal) == 'undefined') { vars.playVal = 0; }
		if(typeof(vars.periodCount) == 'undefined') { vars.periodCount = 0; }
	
		var valueTable = vars.valueTable;
		var playVal = vars.playVal;
		var periodCount = vars.periodCount;

		var period = sampleRate/frequency;
		var p_hundredth = Math.floor((period-Math.floor(period))*100);

		var resetPlay = false;

		if(valueTable.length<=Math.ceil(period)) {
	
			valueTable.push(Math.round(Math.random())*2-1);
	
			return valueTable[valueTable.length-1];
	
		} else {
	
			valueTable[playVal] = (valueTable[playVal>=(valueTable.length-1)?0:playVal+1] + valueTable[playVal]) * 0.5;
	
			if(playVal>=Math.floor(period)) {
				if(playVal<Math.ceil(period)) {
					if((periodCount%100)>=p_hundredth) {
						// Reset
						resetPlay = true;
						valueTable[playVal+1] = (valueTable[0] + valueTable[playVal+1]) * 0.5;
						vars.periodCount++;	
					}
				} else {
					resetPlay = true;	
				}
			}
	
			var _return = valueTable[playVal];
			if(resetPlay) { vars.playVal = 0; } else { vars.playVal++; }
	
			return _return;
	
		}
	}
},
{
	name: 'edm',
	attack:	function() { return 0.002; },
	dampen: function() { return 1; },
	wave: function(i, sampleRate, frequency) {
		var base = this.modulate[0];
		var mod = this.modulate.slice(1);
		return mod[0](
			i,
			sampleRate,
			frequency,
			mod[9](
				i,
				sampleRate,
				frequency,
				mod[2](
					i,
					sampleRate,
					frequency,
					Math.pow(base(i, sampleRate, frequency, 0), 3) +
						Math.pow(base(i, sampleRate, frequency, 0.5), 5) +
						Math.pow(base(i, sampleRate, frequency, 1), 7)
				)
			) +
				mod[8](
					i,
					sampleRate,
					frequency,
					base(i, sampleRate, frequency, 1.75)
				)
		);
	}
});
