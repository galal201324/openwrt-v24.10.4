'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require dom';

/* keepEmpty is reserved for cache values that must preserve an explicit empty string; otherwise empty values clear the cached UCI option. */
function setSetupValue(option, value, keepEmpty) {
	if (value === null || value === undefined || (!keepEmpty && value === ''))
		uci.unset('setup', 'default', option);
	else
		uci.set('setup', 'default', option, value);
}

var setupCacheMappings = [
	['lan_ipaddr', 'network', 'lan', 'ipaddr'],
	['lan_netmask', 'network', 'lan', 'netmask'],
	['WS', 'wireless', 'default_radio0', 'ssid'],
	['WS5', 'wireless', 'default_radio1', 'ssid'],
	['R0K', 'wireless', 'default_radio0', 'key'],
	['R1K', 'wireless', 'default_radio1', 'key'],
	['R0E', 'wireless', 'default_radio0', 'encryption'],
	['R1E', 'wireless', 'default_radio1', 'encryption'],
	['R0D', 'wireless', 'default_radio0', 'disabled'],
	['R1D', 'wireless', 'default_radio1', 'disabled'],
	['R0H', 'wireless', 'radio0', 'htmode'],
	['R1H', 'wireless', 'radio1', 'htmode'],
	['R0C', 'wireless', 'radio0', 'channel'],
	['R1C', 'wireless', 'radio1', 'channel']
];

return view.extend({
	load: function() {
		return Promise.all([
			uci.load('setup'),
			uci.load('network'),
			uci.load('wireless'),
			uci.load('dhcp'),
			uci.load('system')
		]);
	},

	render: function() {
		var m, s, o;

		m = new form.Map('setup', _('Quick Setup'), _('Quick router configuration — change common settings from one page.'));

		/* ── Section: LAN Settings ── */
		s = m.section(form.NamedSection, 'default', 'setup', _('LAN Settings'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Value, 'lan_ipaddr', _('LAN IP Address'),
			_('The IP address of the router on the LAN side.'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.1.1';
		o.rmempty = false;
		o.cfgvalue = function() {
			return uci.get('network', 'lan', 'ipaddr') || uci.get('setup', 'default', 'lan_ipaddr');
		};
		o.write = function(section_id, value) {
			uci.set('setup', section_id, 'lan_ipaddr', value);
			uci.set('network', 'lan', 'ipaddr', value);
		};

		o = s.option(form.Value, 'lan_netmask', _('LAN Netmask'),
			_('The subnet mask for the LAN network.'));
		o.datatype = 'ip4addr';
		o.placeholder = '255.255.255.0';
		o.rmempty = false;
		o.cfgvalue = function() {
			return uci.get('network', 'lan', 'netmask') || uci.get('setup', 'default', 'lan_netmask');
		};
		o.write = function(section_id, value) {
			uci.set('setup', section_id, 'lan_netmask', value);
			uci.set('network', 'lan', 'netmask', value);
		};

		o = s.option(form.ListValue, 'AlwSettings', _('Settings Mode'));
		o.value('AL', _('AL-emprator (Default)'));
		o.value('ALM', _('AL-emprator Mesh'));
		o.value('manual', _('Manual'));
		o.default = 'AL';

		o = s.option(form.Value, 'MWS', _('Mesh ID'));
		o.depends('AlwSettings', 'ALM');
		o.datatype = 'maxlength(32)';
		o.placeholder = 'ALW_KT_MESH';
		o.default = 'ALW_KT_MESH';
		o.rmempty = false;
		o.cfgvalue = function(section_id) {
			return uci.get('setup', section_id, 'MWS') || uci.get('wireless', 'wifinet2', 'mesh_id');
		};
		o.write = function(section_id, value) {
			uci.set('setup', section_id, 'MWS', value);
		};

		o = s.option(form.ListValue, 'SH', _('Mesh Security'));
		o.depends('AlwSettings', 'ALM');
		o.value('SP', _('Password Protected'));
		o.value('NO', _('Open Mesh'));
		o.default = 'SP';
		o.cfgvalue = function(section_id) {
			var encryption = uci.get('wireless', 'wifinet2', 'encryption');

			return uci.get('setup', section_id, 'SH') || (encryption === 'none' ? 'NO' : 'SP');
		};

		o = s.option(form.Value, 'MK', _('Mesh Password'));
		o.depends({ AlwSettings: 'ALM', SH: 'SP' });
		o.datatype = 'wpakey';
		o.password = true;
		o.placeholder = 'absd_ALW_KT_MESH';
		o.cfgvalue = function(section_id) {
			return uci.get('setup', section_id, 'MK') || uci.get('wireless', 'wifinet2', 'key');
		};
		o.write = function(section_id, value) {
			if (value === null || value === undefined || value === '')
				uci.unset('setup', section_id, 'MK');
			else
				uci.set('setup', section_id, 'MK', value);
		};

		/* ── Section: Security Settings ── */
		s = m.section(form.NamedSection, 'default', 'setup', _('Security Settings'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Flag, 'reset_button_disabled', _('Disable Reset Button'),
			_('Ignore the external reset button so factory reset must be triggered from software.'));
		o.enabled = '1';
		o.disabled = '0';
		o.default = '0';

		o = s.option(form.ListValue, 'reset_hold_seconds', _('Factory Reset Hold Time'),
			_('Select how long the external reset button must be held before factory reset is triggered.'));
		o.depends('reset_button_disabled', '0');
		o.value('5', _('5 seconds (default)'));
		o.value('10', _('10 seconds'));
		o.value('20', _('20 seconds'));
		o.value('30', _('30 seconds'));
		o.value('40', _('40 seconds'));
		o.value('60', _('60 seconds'));
		o.default = '5';
		o.rmempty = false;

		/* ── Section: Quick Network (direct UCI on network config) ── */
		var net = new form.Map('network', _('Network Configuration'));

		s = net.section(form.NamedSection, 'lan', 'interface', _('LAN Interface'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Value, 'ipaddr', _('LAN IP Address (network)'),
			_('This is the actual network interface IP address.'));
		o.datatype = 'ip4addr';
		o.placeholder = '192.168.1.1';

		o = s.option(form.Value, 'netmask', _('LAN Netmask (network)'));
		o.datatype = 'ip4addr';
		o.placeholder = '255.255.255.0';

		o = s.option(form.Value, 'gateway', _('Default Gateway'));
		o.datatype = 'ip4addr';
		o.optional = true;

		o = s.option(form.DynamicList, 'dns', _('DNS Servers'));
		o.datatype = 'ip4addr';
		o.optional = true;

		/* ── Section: Quick System ── */
		var sys = new form.Map('system', _('System Configuration'));

		s = sys.section(form.TypedSection, 'system', _('System'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Value, 'hostname', _('Hostname'));
		o.datatype = 'hostname';
		o.placeholder = 'OpenWrt';

		o = s.option(form.ListValue, 'zonename', _('Timezone'));
		o.value('UTC', 'UTC');
		o.value('Asia/Riyadh', 'Asia/Riyadh');
		o.value('Asia/Baghdad', 'Asia/Baghdad');
		o.value('Asia/Dubai', 'Asia/Dubai');
		o.value('Africa/Cairo', 'Africa/Cairo');
		o.value('Asia/Aden', 'Asia/Aden');
		o.value('Asia/Beirut', 'Asia/Beirut');
		o.value('Asia/Damascus', 'Asia/Damascus');
		o.value('Asia/Amman', 'Asia/Amman');
		o.value('Africa/Tripoli', 'Africa/Tripoli');
		o.value('Africa/Tunis', 'Africa/Tunis');
		o.value('Africa/Algiers', 'Africa/Algiers');
		o.value('Africa/Casablanca', 'Africa/Casablanca');
		o.value('Asia/Kuwait', 'Asia/Kuwait');
		o.value('Asia/Muscat', 'Asia/Muscat');
		o.value('Europe/London', 'Europe/London');
		o.value('Europe/Berlin', 'Europe/Berlin');
		o.value('America/New_York', 'America/New_York');
		o.optional = true;

		/* ── Section: Quick Wireless ── */
		var wifi = new form.Map('wireless', _('Wireless Configuration'));

		s = wifi.section(form.TypedSection, 'wifi-iface', _('Wireless Interfaces'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Value, 'ssid', _('SSID (Network Name)'));
		o.datatype = 'maxlength(32)';

		o = s.option(form.ListValue, 'encryption', _('Encryption'));
		o.value('none', _('No Encryption'));
		o.value('psk2', 'WPA2-PSK');
		o.value('psk-mixed', 'WPA/WPA2-PSK Mixed');
		o.value('sae', 'WPA3-SAE');
		o.value('sae-mixed', 'WPA2/WPA3-SAE Mixed');

		o = s.option(form.Value, 'key', _('Wireless Password'));
		o.datatype = 'wpakey';
		o.password = true;
		o.depends('encryption', 'psk2');
		o.depends('encryption', 'psk-mixed');
		o.depends('encryption', 'sae');
		o.depends('encryption', 'sae-mixed');

		o = s.option(form.Flag, 'disabled', _('Disable this interface'));
		o.enabled = '1';
		o.disabled = '0';
		o.default = '0';

		/* ── Section: Quick DHCP ── */
		var dhcp = new form.Map('dhcp', _('DHCP Configuration'));

		s = dhcp.section(form.NamedSection, 'lan', 'dhcp', _('DHCP Server (LAN)'));
		s.anonymous = false;
		s.addremove = false;

		o = s.option(form.Value, 'start', _('DHCP Start'),
			_('First address in the DHCP pool (offset from network address).'));
		o.datatype = 'uinteger';
		o.placeholder = '100';

		o = s.option(form.Value, 'limit', _('DHCP Limit'),
			_('Number of addresses in the DHCP pool.'));
		o.datatype = 'uinteger';
		o.placeholder = '150';

		o = s.option(form.Value, 'leasetime', _('Lease Time'),
			_('Expiry time of DHCP leases, e.g. 12h or 30m.'));
		o.placeholder = '12h';

		return Promise.all([
			m.render(),
			net.render(),
			sys.render(),
			wifi.render(),
			dhcp.render()
		]).then(function(nodes) {
			var container = E('div', {}, nodes);
			return container;
		});
	},

	handleSaveApply: function(ev, mode) {
		return this.handleSave(ev).then(function() {
			ui.changes.apply(mode == '0');
		});
	},

	syncSetupCache: function() {
		/* Legacy setup.default keys are kept for alemprator_s/alemprator_f/alemprator_c compatibility:
		 * WS/WS5=SSIDs, R0K/R1K=keys, R0E/R1E=encryption, R0D/R1D=disabled, R0H/R1H=htmode, R0C/R1C=channel.
		 */
		setupCacheMappings.forEach(function(mapping) {
			setSetupValue(mapping[0], uci.get(mapping[1], mapping[2], mapping[3]));
		});
	},

	handleSave: function(ev) {
		var tasks = [];

		document.getElementById('maincontent')
			.querySelectorAll('.cbi-map').forEach(function(map) {
				tasks.push(dom.callClassMethod(map, 'save'));
			});

		return Promise.all(tasks).then(L.bind(function() {
			/* Refresh setup.default after the active configs have been saved. */
			this.syncSetupCache();
			return uci.save();
		}, this));
	},

	handleReset: function(ev) {
		var tasks = [];

		document.getElementById('maincontent')
			.querySelectorAll('.cbi-map').forEach(function(map) {
				tasks.push(dom.callClassMethod(map, 'reset'));
			});

		return Promise.all(tasks);
	}
});
