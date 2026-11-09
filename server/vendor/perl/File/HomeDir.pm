# Minimal stand-in for CPAN's File::HomeDir, which latexindent loads only to
# find the home folder. macOS Perl lacks the module, so the latexindent that
# ships with MacTeX dies at startup; TeXugo puts this file on PERL5LIB.
package File::HomeDir;
use strict;
our $VERSION = '1.00';
sub my_home { return $ENV{HOME} || (getpwuid($<))[7]; }
1;
