'use strict';
'require view';
'require form';
'require uci';
'require ui';
'require dom';

function setSetupValue(option, value) {
	if (value === null || value === undefined || value === '')
		uci.unset('setup', 'default', option);
	else
		uci.set('setup', 'default', option, value);
}

function getWirelessValue(section, option) {
	return uci.get('wireless', section, option);
}

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
		o.value('manual', _('Manual'));
		o.default = 'AL';

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
		setSetupValue('lan_ipaddr', uci.get('network', 'lan', 'ipaddr'));
		setSetupValue('lan_netmask', uci.get('network', 'lan', 'netmask'));
		setSetupValue('WS', getWirelessValue('default_radio0', 'ssid'));
		setSetupValue('WS5', getWirelessValue('default_radio1', 'ssid'));
		setSetupValue('R0K', getWirelessValue('default_radio0', 'key'));
		setSetupValue('R1K', getWirelessValue('default_radio1', 'key'));
		setSetupValue('R0E', getWirelessValue('default_radio0', 'encryption'));
		setSetupValue('R1E', getWirelessValue('default_radio1', 'encryption'));
		setSetupValue('R0D', getWirelessValue('default_radio0', 'disabled'));
		setSetupValue('R1D', getWirelessValue('default_radio1', 'disabled'));
		setSetupValue('R0H', uci.get('wireless', 'radio0', 'htmode'));
		setSetupValue('R1H', uci.get('wireless', 'radio1', 'htmode'));
		setSetupValue('R0C', uci.get('wireless', 'radio0', 'channel'));
		setSetupValue('R1C', uci.get('wireless', 'radio1', 'channel'));
	},

	handleSave: function(ev) {
		var tasks = [];

		document.getElementById('maincontent')
			.querySelectorAll('.cbi-map').forEach(function(map) {
				tasks.push(dom.callClassMethod(map, 'save'));
			});

		return Promise.all(tasks).then(L.bind(function() {
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
